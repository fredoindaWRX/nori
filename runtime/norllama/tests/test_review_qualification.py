"""Test the independent corpus/oracle without starting inference or tools."""
import json
import contextlib
import io
from pathlib import Path
import sys
import unittest
from types import SimpleNamespace
from unittest.mock import patch
import actual_task_review_probe as probe
sys.path.insert(0, str(Path(__file__).resolve().parent))
from actual_task_review_probe import check_review_oracle, plan, review_cases
from task_review import review_contract, review_messages


class ReviewQualificationTests(unittest.TestCase):
    def test_invalid_case_never_hashes_or_starts_a_worker(self):
        with patch.object(sys, 'argv', ['review-probe', '--case', 'unknown']), \
             patch.object(probe, 'digest') as digest, patch.object(probe, 'WorkerClient') as client, \
             contextlib.redirect_stderr(io.StringIO()), self.assertRaises(SystemExit):
            probe.main()
        digest.assert_not_called();client.assert_not_called()

    def test_diagnostic_is_explicit_and_focused_results_cannot_claim_qualification(self):
        task, raw, allowed, required = review_cases()[0][1:5]
        contract = review_contract(task, raw, allowed, required)
        generated = {'text': json.dumps({'binding_sha256': contract['binding_sha256'],
                     'decision': 'accept', 'issues': [], 'reason': 'Fixture only.'}),
                     'metrics': {'finish_reason': 'stop'}}
        for flag in ([], ['--diagnostic-unconstrained']):
            with self.subTest(flag=flag):
                client = SimpleNamespace(process=SimpleNamespace(pid=123, poll=lambda: 0), close=lambda: None)
                output = io.StringIO()
                with patch.object(sys, 'argv', ['review-probe', '--case', 'valid_read', *flag]), \
                     patch.object(probe, 'digest', return_value='dde5aa3fc5ffc17176b5e8bdc82f587b24b2678c6c66101bf7da77af9f7ccdff'), \
                     patch.object(probe, 'WorkerClient', return_value=client), \
                     patch.object(probe, 'generate', return_value=generated) as generate, \
                     contextlib.redirect_stdout(output):
                    self.assertEqual(probe.main(), 0)
                self.assertEqual(generate.call_args.kwargs['contract_schema'], None if flag else contract['schema'])
                final = json.loads(output.getvalue().splitlines()[-1])
                self.assertFalse(final['full_qualification'])
                self.assertFalse(final['execution_authorized'])
                self.assertEqual(final['cases'], 1)
                self.assertEqual(final['diagnostic_unconstrained'], bool(flag))

    def test_corpus_contains_structurally_valid_positive_and_negative_candidates(self):
        cases = review_cases()
        self.assertEqual(len(cases), 8)
        self.assertEqual(len({case[0] for case in cases}), 8)
        self.assertEqual(sum(case[5] == 'accept' for case in cases), 3)
        for name, task, raw, allowed, required, decision, issues in cases:
            with self.subTest(case=name):
                review_contract(task, raw, allowed, required)
                messages = review_messages(task, raw, allowed, required)
                self.assertEqual(json.loads(messages[1]['content']), {
                    'original_task': task, 'candidate': json.loads(raw)})
                self.assertNotIn('expected_decision', messages[0]['content'])
                self.assertNotIn('supported_issues', messages[0]['content'])
                self.assertTrue(issues if decision == 'reject' else not issues)

    def test_matching_verdict_cannot_hide_observed_false_reason(self):
        raw = plan([{'action': 'write_file', 'path': 'hello.txt', 'content': 'Wrong text'}])
        review = {'decision': 'reject', 'issues': ['argument_mismatch'],
                  'reason': 'The proposal writes a newline character to the file.'}
        with self.assertRaisesRegex(ValueError, 'newline absent'):
            check_review_oracle(review, raw, 'reject', {'argument_mismatch'})

    def test_narrow_reason_check_does_not_flag_negation_or_real_newline(self):
        for content, reason in [('Wrong text', 'The proposal does not write a newline.'),
                                ('Wrong text\n', 'The proposal writes a newline character.')]:
            raw = plan([{'action': 'write_file', 'path': 'hello.txt', 'content': content}])
            check_review_oracle({'decision': 'reject', 'issues': ['argument_mismatch'], 'reason': reason},
                                raw, 'reject', {'argument_mismatch'})

    def test_wrong_verdict_and_unsupported_issue_are_still_refused(self):
        raw = plan([{'action': 'read_file', 'path': 'notes.txt'}])
        with self.assertRaisesRegex(ValueError, 'verdict disagrees'):
            check_review_oracle({'decision': 'accept', 'issues': [], 'reason': 'Fixture'},
                                raw, 'reject', {'task_mismatch'})
        with self.assertRaisesRegex(ValueError, 'unsupported'):
            check_review_oracle({'decision': 'reject', 'issues': ['dependency_mismatch'], 'reason': 'Fixture'},
                                raw, 'reject', {'task_mismatch'})


if __name__ == '__main__': unittest.main()
