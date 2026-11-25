import unittest
from pathlib import Path
import tempfile
from unittest.mock import patch

from .train_instructions import run, initialize_traces
from .model import Config, NoriModel
import torch


class InstructionBudgetTests(unittest.TestCase):
    def test_long_memory_initialization_is_finite_diverse_and_same_graph(self):
        model = NoriModel(Config(width=16, layers=2))
        keys = tuple(model.state_dict())
        initialize_traces(model, 'long-memory')
        self.assertEqual(tuple(model.state_dict()), keys)
        for trace in model.traces:
            retain = (0.8 + 0.199 * torch.sigmoid(trace.decay)).detach()
            self.assertTrue(bool(torch.isfinite(retain).all()))
            self.assertGreater(float(retain.max()), 0.997)
            self.assertLess(float(retain.min()), 0.91)
            self.assertTrue(bool((trace.gate.bias == -2).all()))

    def test_invalid_budgets_rejected_before_model_or_storage(self):
        with patch("training.nori_foundation.train_instructions.NoriModel") as model:
            for steps, seconds in ((0, 20), (513, 20), (True, 20),
                                   (10, 0), (10, 121), (10, True), (10, 1.5)):
                with self.subTest(steps=steps, seconds=seconds):
                    with self.assertRaises(ValueError):
                        run(steps, seconds)
            model.assert_not_called()

    def test_invalid_split_refuses_before_model_or_storage(self):
        with patch("training.nori_foundation.train_instructions.NoriModel") as model:
            for split in ("train", "", None):
                with self.assertRaises(ValueError):
                    run(1, 1, evaluation_split=split)
            model.assert_not_called()

    def test_invalid_capacity_refuses_before_model_or_storage(self):
        with patch("training.nori_foundation.train_instructions.NoriModel") as model:
            for width, layers in ((7, 3), (513, 3), (True, 3), (128, 0), (128, 9), (128, False)):
                with self.subTest(width=width, layers=layers), self.assertRaises(ValueError):
                    run(1, 1, width=width, layers=layers)
            model.assert_not_called()

    def test_tuning_defaults_to_validation_and_receipt_states_limitation(self):
        with tempfile.TemporaryDirectory() as directory, \
             patch("training.nori_foundation.train_instructions.ROOT", Path(directory)), \
             patch("training.nori_foundation.train_instructions.evaluate",
                   return_value={"correct": 0, "total": 1}) as evaluate:
            report = run(1, 1)
            self.assertEqual(evaluate.call_args.kwargs, {"split": "validation", "dataset_version": "v1"})
            self.assertIn("not final qualification", report["evaluation_policy"])
            self.assertFalse(report["assistant_qualified"])
            self.assertFalse(report["production_default_changed"])
            self.assertEqual(report["config"], {"width": 128, "layers": 3})


if __name__ == "__main__":
    unittest.main()
