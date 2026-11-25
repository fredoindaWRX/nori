"""Bounded scratch instruction trial; no default changes or external weights."""
import argparse
from dataclasses import asdict
from hashlib import sha256
import json
from pathlib import Path
import tempfile
import time

import torch
from torch.nn import functional as F

from .instruction_data import examples, fingerprint, answer_training_pair
from .model import Config, NoriModel, export_checkpoint, load_checkpoint
from .task_evaluation import evaluate

ROOT = Path(__file__).resolve().parents[2]


def initialize_traces(model, mode):
    if mode not in ("legacy", "long-memory"):
        raise ValueError("Unknown trace initialization")
    if mode == "long-memory":
        # Same graph/equations/native format; diversify initial retention horizons.
        with torch.no_grad():
            horizons = torch.logspace(1, 2.7, model.config.width)
            retain = torch.exp(-1 / horizons)
            normalized = ((retain - 0.8) / 0.199).clamp(0.0001, 0.9999)
            for trace in model.traces:
                trace.decay.copy_(torch.logit(normalized))
                trace.gate.bias.fill_(-2.0)


def run(steps=128, seconds=30, *, evaluation_split="validation", width=128, layers=3,
        dataset_version="v1", trace_initialization="legacy"):
    if type(steps) is not int or not 1 <= steps <= 512:
        raise ValueError("Steps must be 1..512")
    if type(seconds) is not int or not 1 <= seconds <= 120:
        raise ValueError("Training seconds must be 1..120")
    if evaluation_split not in ("validation", "test"):
        raise ValueError("Evaluation split must be validation or explicit test")
    config = Config(width=width, layers=layers)
    rows = examples(dataset_version)
    if trace_initialization not in ("legacy", "long-memory"):
        raise ValueError("Unknown trace initialization")
    torch.set_num_threads(1)
    torch.manual_seed(20260930)
    training = tuple(r for r in rows if r.split == "train")
    pairs = [answer_training_pair(r) for r in training]
    model = NoriModel(config)
    initialize_traces(model, trace_initialization)
    optimizer = torch.optim.AdamW(model.parameters(), lr=0.003)
    generator = torch.Generator().manual_seed(20260930)
    started = time.monotonic()
    losses = []
    for step in range(steps):
        if time.monotonic() - started >= seconds:
            break
        batch = [pairs[i] for i in torch.randint(len(pairs), (8,), generator=generator).tolist()]
        length = max(len(x) for x, _ in batch)
        x = torch.tensor([a + [0] * (length - len(a)) for a, _ in batch], dtype=torch.long)
        y = torch.tensor([b + [-100] * (length - len(b)) for _, b in batch], dtype=torch.long)
        optimizer.zero_grad(set_to_none=True)
        scores, _ = model(x)
        loss = F.cross_entropy(scores.reshape(-1, 258), y.reshape(-1), ignore_index=-100)
        if not bool(torch.isfinite(loss)):
            raise RuntimeError("Nonfinite instruction loss")
        loss.backward()
        torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0, error_if_nonfinite=True)
        optimizer.step()
        losses.append(float(loss.detach()))
        if len(losses) % 16 == 0:
            print(json.dumps({"step": len(losses), "loss": losses[-1]}), flush=True)
    elapsed = time.monotonic() - started
    destination = ROOT / "models/nori-development"
    destination.mkdir(parents=True, exist_ok=True)
    directory = Path(tempfile.mkdtemp(prefix="dualtrace-instructions-", dir=destination))
    checkpoint = directory / "weights.nori"
    provenance = {"origin": "random_initialization", "assistant_qualified": False,
                  "external_weights": False, "distillation": False,
                  "training_data": "newly_authored_synthetic_instruction_fixtures",
                  "dataset_version": dataset_version,
                  "trace_initialization": trace_initialization,
                  "train_sha256": fingerprint(training), "seed": 20260930,
                  "steps": len(losses)}
    export_checkpoint(model, checkpoint, provenance)
    restored, _ = load_checkpoint(checkpoint)
    probe = torch.tensor([[256, 65, 66]], dtype=torch.long)
    with torch.no_grad():
        exact = torch.equal(model(probe)[0], restored(probe)[0])
    if not exact:
        raise RuntimeError("Checkpoint roundtrip mismatch")
    report = {"config": asdict(model.config), "parameters": sum(p.numel() for p in model.parameters()),
              "device": "cpu", "steps": len(losses), "training_seconds": elapsed,
              "budget_note": "Deadline checked between steps; startup/evaluation excluded",
              "losses": losses, "roundtrip_exact": exact, "provenance": provenance,
              "checkpoint_sha256": sha256(checkpoint.read_bytes()).hexdigest(),
              "held_out": evaluate(restored.generate, split=evaluation_split,
                                   dataset_version=dataset_version),
              "evaluation_policy": "Validation for tuning; legacy test already observed, not final qualification",
              "assistant_qualified": False,
              "production_default_changed": False}
    with (directory / "instruction-receipt.json").open("x", encoding="utf-8") as handle:
        json.dump(report, handle, indent=2, allow_nan=False)
    print(json.dumps({"directory": str(directory), "steps": len(losses),
                      "held_out_correct": report["held_out"]["correct"],
                      "held_out_total": report["held_out"]["total"],
                      "assistant_qualified": False}), flush=True)
    return report


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--steps", type=int, default=128)
    parser.add_argument("--seconds", type=int, default=30)
    parser.add_argument("--width", type=int, default=128)
    parser.add_argument("--layers", type=int, default=3)
    parser.add_argument("--dataset-version", choices=("v1", "v2-balanced"), default="v1")
    parser.add_argument("--trace-initialization", choices=("legacy", "long-memory"), default="legacy")
    parser.add_argument("--evaluation-split", choices=("validation", "test"), default="validation",
                        help="Validation is default; legacy test is diagnostic, not pristine acceptance")
    options = parser.parse_args()
    run(options.steps, options.seconds, evaluation_split=options.evaluation_split,
        width=options.width, layers=options.layers, dataset_version=options.dataset_version,
        trace_initialization=options.trace_initialization)
