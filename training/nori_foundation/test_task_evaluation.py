import unittest

from .instruction_data import examples
from .task_evaluation import evaluate


class TaskEvaluationTests(unittest.TestCase):
    def test_balanced_version_cannot_be_passed_by_constant_refusal(self):
        rows = examples('v2-balanced')
        permission = [row for row in rows if row.category == 'permission']
        self.assertEqual(sum(row.answer == 'Yes.' for row in permission), 128)
        self.assertEqual(sum(row.answer == 'No.' for row in permission), 128)
        for split in ('train', 'validation', 'test'):
            self.assertEqual({row.answer for row in permission if row.split == split}, {'Yes.', 'No.'})
        result = evaluate(lambda prompt, limit: 'No.', 'validation', dataset_version='v2-balanced')
        self.assertLess(result['categories']['permission']['correct'], result['categories']['permission']['total'])
        self.assertFalse(result['assistant_qualified'])

    def test_exact_oracle_scores_all_but_never_qualifies(self):
        answers = {f"[user]\n{r.question}\n[assistant]\n": r.answer for r in examples()}
        report = evaluate(lambda prompt, limit: answers[prompt])
        self.assertEqual(report["correct"], report["total"])
        self.assertFalse(report["assistant_qualified"])

    def test_constant_refusal_cannot_hide_other_task_failures(self):
        report = evaluate(lambda prompt, limit: "No.")
        self.assertEqual(report["categories"]["arithmetic"]["correct"], 0)
        self.assertEqual(report["categories"]["copy"]["correct"], 0)
        self.assertLess(report["correct"], report["total"])

    def test_errors_and_non_text_are_failures_not_skips(self):
        report = evaluate(lambda prompt, limit: None)
        self.assertEqual(report["correct"], 0)
        self.assertEqual(sum(v["errors"] for v in report["categories"].values()), report["total"])
        self.assertTrue(all(r["error_type"] == "TypeError" for r in report["outcomes"]))

    def test_training_split_refused_and_whitespace_not_silently_fixed(self):
        with self.assertRaises(ValueError):
            evaluate(lambda prompt, limit: "", "train")
        answers = {f"[user]\n{r.question}\n[assistant]\n": r.answer for r in examples()}
        report = evaluate(lambda prompt, limit: answers[prompt] + " ")
        self.assertEqual(report["correct"], 0)


if __name__ == "__main__":
    unittest.main()
