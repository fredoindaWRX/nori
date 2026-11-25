from hashlib import sha256
import json
from pathlib import Path
import struct
import tempfile
import unittest

import torch
from torch.nn import functional as F
from .model import Config, NoriModel, MAX_CHECKPOINT, MAX_HEADER, parameter_count, encode, decode, export_checkpoint, load_checkpoint


class NoriModelTests(unittest.TestCase):
    def test_expanded_graph_parameter_and_storage_bounds(self):
        for config in (Config(8,1),Config(128,3),Config(512,8)):
            model=NoriModel(config)
            self.assertEqual(parameter_count(config),sum(p.numel() for p in model.parameters()))
            self.assertLess(4*parameter_count(config)+MAX_HEADER+12,MAX_CHECKPOINT)
        for config in ({"width":513},{"layers":9},{"width":True},{"layers":False}):
            with self.assertRaises(ValueError):Config(**config)

    def setUp(self):
        torch.set_num_threads(1)
        torch.manual_seed(13)
        self.model = NoriModel(Config(width=8, layers=1))

    def test_byte_tokenizer_preserves_unicode(self):
        for text in ["", "Nori", "purple 🟣", "café", "東京\n"]:
            self.assertEqual(decode(encode(text)), text)
        with self.assertRaises(ValueError):
            decode([258])

    def test_forward_is_causal(self):
        a = torch.tensor([[256, 12, 44, 91]])
        b = torch.tensor([[256, 12, 88, 30]])
        self.assertTrue(torch.equal(self.model(a)[0][:, :2], self.model(b)[0][:, :2]))

    def test_streaming_equals_full_and_reset_isolated(self):
        tokens = torch.tensor([[256, 10, 22, 25, 257]])
        full, _ = self.model(tokens)
        first, state = self.model(tokens[:, :2])
        second, _ = self.model(tokens[:, 2:], state)
        self.assertTrue(torch.allclose(full, torch.cat((first, second), dim=1), atol=1e-6))
        self.assertTrue(torch.equal(full, self.model(tokens)[0]))

    def test_real_backward_updates_own_random_weights(self):
        x = torch.tensor([[256, 10, 22]])
        y = torch.tensor([[10, 22, 257]])
        before = self.model.output.weight.detach().clone()
        optimizer = torch.optim.SGD(self.model.parameters(), lr=0.01)
        loss = F.cross_entropy(self.model(x)[0].reshape(-1, 258), y.reshape(-1))
        loss.backward(); optimizer.step()
        self.assertFalse(torch.equal(before, self.model.output.weight))

    def test_data_only_checkpoint_roundtrip_corruption_and_no_overwrite(self):
        directory = Path(__file__).resolve().parents[2] / "verification"
        with tempfile.TemporaryDirectory(prefix=".nori-model-test-", dir=directory) as name:
            path = Path(name) / "weights.nori"
            provenance = {"origin": "random_initialization", "assistant_qualified": False}
            export_checkpoint(self.model, path, provenance)
            loaded, info = load_checkpoint(path)
            self.assertEqual(info, provenance)
            for key, tensor in self.model.state_dict().items():
                self.assertTrue(torch.equal(tensor, loaded.state_dict()[key]))
            with self.assertRaises(FileExistsError):
                export_checkpoint(self.model, path, provenance)
            raw = path.read_bytes()
            for changed in [raw[:-1], raw + b"tail", raw[:12] + b"bad", raw[:-1] + bytes([raw[-1] ^ 1])]:
                path.write_bytes(changed)
                with self.assertRaises((ValueError, json.JSONDecodeError)):
                    load_checkpoint(path)
            # Even with a recomputed digest, tensor shapes must match this graph.
            length = struct.unpack("<I", raw[8:12])[0]
            metadata = json.loads(raw[12:12+length]);payload = raw[12+length:]
            metadata["tensors"][0]["shape"] = [1]
            metadata["sha256"] = sha256(payload).hexdigest()
            encoded = json.dumps(metadata).encode()
            path.write_bytes(raw[:8] + struct.pack("<I", len(encoded)) + encoded + payload)
            with self.assertRaises(ValueError):
                load_checkpoint(path)

    def test_resource_and_qualification_bounds(self):
        for config in [{"width": 0}, {"width": 1000}, {"layers": 0}, {"layers": 99}]:
            with self.assertRaises(ValueError):
                Config(**config)
        for tokens in [torch.empty(1, 0, dtype=torch.long), torch.zeros(1, 513, dtype=torch.long),
                       torch.tensor([[258]]), torch.zeros(1, 1)]:
            with self.assertRaises(ValueError):
                self.model(tokens)
        with self.assertRaises(ValueError):
            self.model.generate("x", 10000)
        for prompt, limit in [("x" * 100000, 1), ("🟣" * 128, 1), ("x" * 511, 1), (None, 1)]:
            with self.assertRaises(ValueError):
                self.model.generate(prompt, limit)
        with self.assertRaises(ValueError):
            export_checkpoint(self.model, Path("unused"), {"origin":"random_initialization", "assistant_qualified":True})


if __name__ == "__main__":
    unittest.main()
