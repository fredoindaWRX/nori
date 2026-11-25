"""Real own-engine CPU/CUDA parity. Requires the explicit diagnostic build.

No GPU-unavailable skip: this qualification must fail if CUDA cannot execute.
Tests create only fresh disposable fixtures below C:/Nori/verification.
"""
import argparse
from hashlib import sha256
import json
import os
from pathlib import Path
import struct
import subprocess
import tempfile
import unittest
from unittest.mock import patch

import torch

from .model import Config, EOS, NoriModel, encode, export_checkpoint, load_checkpoint
from .native_export import export_native

ROOT = Path(__file__).resolve().parents[2]
BINARY = ROOT / "engine" / "norama" / "norama-dualtrace.exe"
TRAINED = ROOT / "models" / "nori-development" / "dualtrace-v0-b8_o6n4g" / "weights.nori"
ATOL, RTOL = 2e-5, 2e-5
EVIDENCE = []


def run_native(path, device, tokens, generation=None):
    argv = [str(BINARY), str(path), device]
    if generation is not None:
        argv.append(f"--generate={generation}")
    argv.extend(map(str, tokens))
    return subprocess.run(argv, cwd=ROOT, capture_output=True, text=True,
                          timeout=30, check=False)


@torch.no_grad()
def reference(model, tokens, generation=0):
    scores, state = model(torch.tensor([tokens], dtype=torch.long))
    last = scores[:, -1:]
    generated = []
    for _ in range(generation):
        token = int(last[0, -1].argmax())
        if token == EOS:
            break
        generated.append(token)
        last, state = model(torch.tensor([[token]], dtype=torch.long), state)
    return scores[0], generated


class NativeTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        torch.set_num_threads(1)
        if not BINARY.is_file() or not TRAINED.is_file():
            raise RuntimeError("Build own DualTrace diagnostic and train the bounded probe first")
        cls.temporary = tempfile.TemporaryDirectory(prefix=".nori-native-test-", dir=ROOT / "verification")
        cls.directory = Path(cls.temporary.name).resolve()
        if not cls.directory.is_relative_to((ROOT / "verification").resolve()):
            raise RuntimeError("Fixture directory escaped verification root")
        cls.model, _ = load_checkpoint(TRAINED)
        cls.native = cls.directory / "trained.ndt"
        export_native(TRAINED, cls.native)

    @classmethod
    def tearDownClass(cls):
        cls.temporary.cleanup()

    def check_parity(self, model, path, tokens, label, generation=0):
        expected, expected_generated = reference(model, tokens, generation)
        outputs = {}
        for device in ("cpu", "gpu"):
            process = run_native(path, device, tokens, generation or None)
            self.assertEqual(process.returncode, 0, process.stderr)
            result = json.loads(process.stdout)
            self.assertEqual(result["architecture"], "nori-dualtrace-v0")
            self.assertIs(result["assistant_qualified"], False)
            self.assertEqual(result["device"], device)
            self.assertEqual(result["parameters"], sum(p.numel() for p in model.parameters()))
            self.assertEqual(result["reset_max_error"], 0)
            if device == "gpu":
                self.assertIn("RTX 4080 SUPER", result["device_name"])
            actual = torch.tensor(result["logits"], dtype=torch.float32)
            self.assertEqual(actual.shape, expected.shape)
            torch.testing.assert_close(actual, expected, atol=ATOL, rtol=RTOL)
            self.assertEqual(result["generated"], expected_generated)
            outputs[device] = actual
            EVIDENCE.append({"case": label, "device": device, "device_name": result["device_name"],
                             "tokens": len(tokens), "parameters": result["parameters"],
                             "max_abs_logit_error": float((actual - expected).abs().max()),
                             "reset_max_error": result["reset_max_error"],
                             "greedy_generation_equal": True, "generation_length": len(expected_generated)})
        torch.testing.assert_close(outputs["cpu"], outputs["gpu"], atol=ATOL, rtol=RTOL)
        return outputs

    def test_trained_weights_all_logits_and_generation(self):
        for text in ("", "Nori", "purple 🟣 café 東京\n", "Nori is local. " * 8):
            with self.subTest(text=text):
                self.check_parity(self.model, self.native, encode(text)[:-1],
                                  f"trained-{len(text.encode('utf-8'))}-bytes", generation=32)

    def test_minimum_and_maximum_graph_shapes(self):
        for width, layers in ((8, 1), (8, 2), (64, 1), (64, 2), (8, 8), (128, 3), (512, 1), (512, 8)):
            with self.subTest(width=width, layers=layers):
                torch.manual_seed(100 + width + layers)
                model = NoriModel(Config(width=width, layers=layers)).eval()
                source = self.directory / f"shape-{width}-{layers}.nori"
                native = source.with_suffix(".ndt")
                export_checkpoint(model, source, {"origin": "random_initialization", "assistant_qualified": False})
                export_native(source, native)
                self.check_parity(model, native, [256, 0, 255, 257, 17, 8], f"shape-{width}-{layers}", generation=16)

    def test_full_512_token_budget_and_reset(self):
        tokens = [256] + [i % 256 for i in range(511)]
        self.check_parity(self.model, self.native, tokens, "full-512-token-session")

    def test_causality_and_fresh_requests(self):
        for device in ("cpu", "gpu"):
            a = run_native(self.native, device, [256, 10, 20, 30])
            b = run_native(self.native, device, [256, 10, 99, 100])
            c = run_native(self.native, device, [256, 10, 20, 30])
            for process in (a, b, c):
                self.assertEqual(process.returncode, 0, process.stderr)
            a, b, c = (json.loads(p.stdout) for p in (a, b, c))
            self.assertEqual(a["logits"][:2], b["logits"][:2])
            self.assertEqual(a["logits"], c["logits"])

    def test_export_contract_and_no_overwrite(self):
        raw = self.native.read_bytes()
        self.assertEqual(raw[:8], b"NDT0F32\0")
        self.assertEqual(struct.unpack("<6I", raw[8:32]),
                         (1, self.model.config.width, self.model.config.layers,
                          sum(p.numel() for p in self.model.parameters()), 1, 0))
        self.assertEqual(raw[32:64], sha256(TRAINED.read_bytes()).digest())
        self.assertEqual(raw[64:96], sha256(raw[96:]).digest())
        self.assertEqual(len(raw), 96 + 4 * sum(p.numel() for p in self.model.parameters()))
        with self.assertRaises(FileExistsError):
            export_native(TRAINED, self.native)
        self.assertEqual(self.native.read_bytes(), raw)

    def test_export_uses_one_validated_snapshot(self):
        target = self.directory / "snapshot.ndt"
        original_open = Path.open
        reads = []

        def counted_open(path, *args, **kwargs):
            if path == TRAINED:
                reads.append(path)
                if len(reads) > 1:
                    raise AssertionError("Exporter re-read source after validation")
            return original_open(path, *args, **kwargs)

        with patch.object(Path, "open", counted_open):
            export_native(TRAINED, target)
        self.assertEqual(len(reads), 1)
        self.assertEqual(target.read_bytes(), self.native.read_bytes())

    def test_corrupt_or_unqualified_models_rejected_on_both_devices(self):
        raw = self.native.read_bytes()
        cases = {"truncated": raw[:-1], "trailing": raw + b"x", "short-header": raw[:95],
                 "bad-magic": b"BADMAGIC" + raw[8:],
                 "bad-digest": raw[:-1] + bytes([raw[-1] ^ 1])}
        for label, offset, value in (("version", 8, 2), ("width", 12, 513),
                                     ("layers", 16, 9), ("count", 20, 1),
                                     ("imported-origin", 24, 0), ("qualified-claim", 28, 1)):
            changed = bytearray(raw)
            struct.pack_into("<I", changed, offset, value)
            cases[label] = bytes(changed)
        nonfinite = bytearray(raw)
        struct.pack_into("<f", nonfinite, 96, float("nan"))
        nonfinite[64:96] = sha256(nonfinite[96:]).digest()
        cases["nonfinite-valid-digest"] = bytes(nonfinite)
        for label, content in cases.items():
            path = self.directory / f"invalid-{label}.ndt"
            path.write_bytes(content)
            for device in ("cpu", "gpu"):
                with self.subTest(case=label, device=device):
                    process = run_native(path, device, [256])
                    self.assertEqual(process.returncode, 1)
                    self.assertEqual(process.stdout, "")
                    self.assertTrue(process.stderr.strip())

    def test_cli_bounds_and_no_implicit_fallback(self):
        cases = [("cpu", [], None), ("cpu", [258], None), ("cpu", [-1], None),
                 ("cpu", ["nan"], None), ("cpu", [256], 0), ("cpu", [256], 257),
                 ("gpu", [0] * 513, None), ("gpu", [0] * 512, 1),
                 ("auto", [256], None), ("ollama", [256], None)]
        for device, tokens, generation in cases:
            with self.subTest(device=device, length=len(tokens), generation=generation):
                process = run_native(self.native, device, tokens, generation)
                self.assertEqual(process.returncode, 1)
                self.assertEqual(process.stdout, "")
                self.assertTrue(process.stderr.strip())


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--receipt", type=Path)
    parser.add_argument("--checkpoint", type=Path)
    args = parser.parse_args()
    if args.checkpoint:
        candidate = args.checkpoint.resolve(strict=True)
        if not candidate.is_relative_to((ROOT / "models/nori-development").resolve()):
            raise ValueError("Explicit checkpoint must be under Nori development models")
        TRAINED = candidate
    receipt = None
    if args.receipt:
        receipt = args.receipt.resolve()
        if receipt.parent != (ROOT / "verification").resolve() or receipt.exists():
            raise ValueError("Receipt must be a fresh file directly under verification")
    result = unittest.TextTestRunner(verbosity=2).run(unittest.defaultTestLoader.loadTestsFromTestCase(NativeTests))
    if receipt:
        record = {"passed": result.wasSuccessful(), "tests_run": result.testsRun,
                  "failures": len(result.failures), "errors": len(result.errors),
                  "atol": ATOL, "rtol": RTOL, "cases": EVIDENCE,
                  "assistant_qualified": False, "production_default_changed": False,
                  "binary_sha256": sha256(BINARY.read_bytes()).hexdigest(),
                  "training_checkpoint_sha256": sha256(TRAINED.read_bytes()).hexdigest(),
                  "sources": {str(path.relative_to(ROOT)): sha256(path.read_bytes()).hexdigest()
                              for path in (Path(__file__), ROOT / "training/nori_foundation/model.py",
                                           ROOT / "training/nori_foundation/native_export.py",
                                           ROOT / "engine/norama/src/dualtrace.cu",
                                           ROOT / "engine/norama/src/dualtrace_gpu.cuh",
                                           ROOT / "engine/norama/src/dualtrace_model.hpp")}}
        with receipt.open("x", encoding="utf-8") as handle:
            json.dump(record, handle, indent=2, allow_nan=False)
            handle.flush()
            os.fsync(handle.fileno())
    raise SystemExit(0 if result.wasSuccessful() else 1)
