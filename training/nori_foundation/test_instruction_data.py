import unittest

from .instruction_data import Example, answer_training_pair, examples, fingerprint
from .model import EOS


class InstructionDataTests(unittest.TestCase):
    def test_deterministic_disjoint_nonempty_splits(self):
        rows = examples()
        self.assertEqual(len(rows), 448)
        self.assertEqual(fingerprint(rows), fingerprint(examples()))
        self.assertEqual(len({r.question for r in rows}), len(rows))
        for category in ("arithmetic", "copy", "permission"):
            for split in ("train", "validation", "test"):
                self.assertTrue(any(r.category == category and r.split == split for r in rows))

    def test_only_answer_and_eos_contribute_loss(self):
        row = Example("copy", "Copy exactly: café", "café")
        inputs, targets = answer_training_pair(row)
        self.assertEqual(len(inputs), len(targets))
        self.assertEqual([t for t in targets if t != -100], [*row.answer.encode("utf-8"), EOS])
        first = next(i for i, t in enumerate(targets) if t != -100)
        self.assertEqual(inputs[first], ord("\n"))

    def test_every_fixture_fits_and_oversize_refused(self):
        for row in examples():
            inputs, targets = answer_training_pair(row)
            self.assertLessEqual(len(inputs) + 1, 512)
            self.assertEqual(targets[-1], EOS)
        with self.assertRaises(ValueError):
            answer_training_pair(Example("copy", "x" * 512, "x"))


if __name__ == "__main__":
    unittest.main()
