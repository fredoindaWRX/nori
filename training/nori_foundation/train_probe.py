"""Bounded offline scratch-training proof. Not an assistant qualification."""
import argparse
from dataclasses import asdict
from hashlib import sha256
import json
import math
from pathlib import Path
import tempfile
import time

import torch
from torch.nn import functional as F
from .model import Config, NoriModel, encode, export_checkpoint, load_checkpoint

ROOT = Path(__file__).resolve().parents[2]
# Newly authored synthetic fixtures, not user history/repo ingestion or distillation.
TRAIN = (
    "Nori uses a local runtime. Nori preserves files until changes are verified.\n"
    "A failed test means the feature is not ready. A missing file is not success.\n"
    "Nori can report uncertainty. A model proposal does not authorize a tool.\n"
    "The screen workspace contains movable panels and one assistant entity.\n"
    "Model weights, runtime and interface are different parts of the system.\n"
    "Local training starts with random parameters and measured loss.\n"
    "Check the expected result before claiming the task is finished.\n"
    "Permission, cancellation and resource limits remain enforced.\n"
)
HELD_OUT = (
    "A useful assistant needs evaluation on new tasks.\n"
    "Saving project documents is not foundation model training.\n"
    "Tell the owner which behavior has actually been tested.\n"
)


def corpus_hash(text):
    return sha256(text.encode("utf-8")).hexdigest()


def loss_on(model, tokens, context=48):
    losses, count = 0.0, 0
    with torch.no_grad():
        for start in range(0, len(tokens) - 1, context):
            end = min(start + context, len(tokens) - 1)
            x = torch.tensor([tokens[start:end]], dtype=torch.long)
            y = torch.tensor(tokens[start + 1:end + 1], dtype=torch.long)
            logits, _ = model(x)
            losses += float(F.cross_entropy(logits.reshape(-1, 258), y, reduction="sum"))
            count += len(y)
    return losses / count


def run(steps=64, seconds=30):
    if type(steps) is not int or not 1 <= steps <= 128 or not 1 <= seconds <= 60:
        raise ValueError("Prototype budget exceeded")
    torch.set_num_threads(1)
    torch.manual_seed(20260930)
    model = NoriModel(Config())
    train, held_out = encode(TRAIN), encode(HELD_OUT)
    initial = loss_on(model, train)
    initial_held_out = loss_on(model, held_out)
    optimizer = torch.optim.AdamW(model.parameters(), lr=0.006)
    generator = torch.Generator().manual_seed(20260930)
    started = time.monotonic()
    completed = 0
    for step in range(steps):
        if time.monotonic() - started > seconds:
            break
        starts = torch.randint(0, len(train) - 49, (4,), generator=generator).tolist()
        x = torch.tensor([train[start:start + 48] for start in starts], dtype=torch.long)
        y = torch.tensor([train[start + 1:start + 49] for start in starts], dtype=torch.long)
        optimizer.zero_grad(set_to_none=True)
        logits, _ = model(x)
        loss = F.cross_entropy(logits.reshape(-1, 258), y.reshape(-1))
        if not bool(torch.isfinite(loss)):
            raise RuntimeError("Nonfinite training loss")
        loss.backward()
        torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0, error_if_nonfinite=True)
        optimizer.step()
        completed = step + 1
        if completed % 16 == 0:
            print(json.dumps({"step": completed, "batch_loss": float(loss.detach())}), flush=True)
    final, held = loss_on(model, train), loss_on(model, held_out)
    provenance = {"origin": "random_initialization", "assistant_qualified": False,
        "training_data": "newly_authored_synthetic_pipeline_fixtures",
        "external_weights": False, "distillation": False, "train_sha256": corpus_hash(TRAIN),
        "held_out_sha256": corpus_hash(HELD_OUT), "seed": 20260930, "steps": completed}
    destination = ROOT / "models" / "nori-development"
    destination.mkdir(parents=True, exist_ok=True)
    directory = Path(tempfile.mkdtemp(prefix="dualtrace-v0-", dir=destination))
    checkpoint = directory / "weights.nori"
    export_checkpoint(model, checkpoint, provenance)
    restored, _ = load_checkpoint(checkpoint)
    probe = torch.tensor([encode("Nori")[:-1]], dtype=torch.long)
    with torch.no_grad():
        reload_exact = torch.equal(model(probe)[0], restored(probe)[0])
    report = {"model": "Nori DualTrace v0", "config": asdict(model.config),
        "parameters": sum(t.numel() for t in model.parameters()), "device": "cpu",
        "torch_version": torch.__version__, "steps": completed,
        "seconds": time.monotonic() - started, "train_loss_initial": initial,
        "train_loss_final": final, "held_out_loss_initial": initial_held_out,
        "held_out_loss_final": held, "held_out_perplexity": math.exp(min(held, 50)),
        "checkpoint": str(checkpoint), "checkpoint_bytes": checkpoint.stat().st_size,
        "checkpoint_sha256": sha256(checkpoint.read_bytes()).hexdigest(),
        "round_trip_exact": reload_exact, "generation_sample": restored.generate("Nori ", 48),
        "assistant_qualified": False, "production_default_changed": False, "provenance": provenance}
    with (directory / "training-receipt.json").open("x", encoding="utf-8") as handle:
        json.dump(report, handle, indent=2, allow_nan=False)
    print(json.dumps(report), flush=True)
    if not reload_exact or not final < initial:
        raise RuntimeError("Scratch-training pipeline failed; receipt preserved")
    return report


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--steps", type=int, default=64)
    parser.add_argument("--seconds", type=int, default=30)
    options = parser.parse_args()
    run(options.steps, options.seconds)
