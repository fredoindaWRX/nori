import contextlib
import io
import json
from pathlib import Path
import sys
from types import SimpleNamespace
import unittest
from unittest.mock import patch, Mock
sys.path.insert(0, str(Path(__file__).resolve().parent))
import actual_typed_plan_probe as probe


class QualificationCliTests(unittest.TestCase):
    def test_invalid_extended_selection_refuses_before_hash_or_worker_start(self):
        with patch.object(sys, 'argv', ['probe', '--case', 'unicode_read']), \
             patch.object(probe, 'digest') as digest, patch.object(probe, 'WorkerClient') as worker, \
             contextlib.redirect_stderr(io.StringIO()), self.assertRaises(SystemExit) as error:
            probe.main()
        self.assertEqual(error.exception.code, 2)
        digest.assert_not_called(); worker.assert_not_called()

    def test_candidate_without_checksum_refuses_before_worker_start(self):
        with patch.object(sys, 'argv', ['probe', '--checkpoint', 'missing.gguf']), \
             patch.object(probe, 'digest') as digest, patch.object(probe, 'WorkerClient') as worker, \
             contextlib.redirect_stderr(io.StringIO()), self.assertRaises(SystemExit) as error:
            probe.main()
        self.assertEqual(error.exception.code, 2)
        digest.assert_not_called(); worker.assert_not_called()

    def test_focused_pass_is_explicitly_not_full_qualification(self):
        fake = SimpleNamespace(close=Mock(), process=SimpleNamespace(pid=123, poll=lambda: 0))
        candidate = {'status': 'proposed', 'steps': [
            {'id': 'a', 'call': {'action': 'read_file', 'path': 'notes.txt'}, 'depends_on': []},
            {'id': 'b', 'call': {'action': 'read_file', 'path': 'second.txt'}, 'depends_on': ['a']}]}
        generation = {'text': json.dumps(candidate), 'metrics': {'finish_reason': 'stop'}}
        output = io.StringIO()
        with patch.object(sys, 'argv', ['probe', '--case', 'dependent_reads', '--contract-guard']), \
             patch.object(probe, 'digest', return_value='dde5aa3fc5ffc17176b5e8bdc82f587b24b2678c6c66101bf7da77af9f7ccdff'), \
             patch.object(probe, 'WorkerClient', return_value=fake), \
             patch.object(probe, 'generate', return_value=generation), contextlib.redirect_stdout(output):
            self.assertEqual(probe.main(), 0)
        final = json.loads(output.getvalue().splitlines()[-1])
        self.assertEqual(final['cases'], 1)
        self.assertFalse(final['full_qualification'])
        self.assertFalse(final['execution_authorized'])
        fake.close.assert_called_once()


if __name__ == '__main__': unittest.main()
