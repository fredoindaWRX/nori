"""Performance harness checks without starting hardware or touching models."""
import contextlib
import io
import json
from pathlib import Path
import sys
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch
sys.path.insert(0, str(Path(__file__).resolve().parent))
import actual_performance_probe as probe


class PerformanceProbeTests(unittest.TestCase):
    def test_invalid_candidate_pair_and_runs_refuse_before_hash_or_spawn(self):
        for args in [['--worker', 'candidate.exe'], ['--sha256', 'a' * 64], ['--runs', '0'], ['--runs', '6']]:
            with self.subTest(args=args), patch.object(sys, 'argv', ['probe', *args]), \
                 patch.object(probe, 'digest') as digest, patch.object(probe, 'WorkerClient') as client, \
                 contextlib.redirect_stderr(io.StringIO()), self.assertRaises(SystemExit): probe.main()
            digest.assert_not_called();client.assert_not_called()

    def test_candidate_checksum_mismatch_refuses_before_spawn(self):
        with patch.object(sys, 'argv', ['probe', '--worker', 'candidate.exe', '--sha256', 'a' * 64]), \
             patch.object(probe, 'digest', return_value='b' * 64), patch.object(probe, 'WorkerClient') as client, \
             self.assertRaisesRegex(ValueError, 'Worker changed'): probe.main()
        client.assert_not_called()

    def test_owned_cleanup_and_metadata_do_not_claim_qualification(self):
        closed = Mock()
        client = SimpleNamespace(close=closed, process=SimpleNamespace(poll=lambda: 0, pid=123))
        output = io.StringIO()
        def digest(path): return probe.MODEL_SHA if path.suffix == '.gguf' else 'a' * 64
        sample = {'text': 'OK', 'metrics': {'finish_reason': 'stop'}}
        with patch.object(sys, 'argv', ['probe', '--runs', '1']), patch.object(probe, 'digest', side_effect=digest), \
             patch.object(probe, 'WorkerClient', return_value=client), \
             patch.object(probe, 'generate', return_value=sample), contextlib.redirect_stdout(output):
            probe.main()
        closed.assert_called_once()
        final = json.loads(output.getvalue().splitlines()[-1])
        self.assertFalse(final['full_qualification']);self.assertFalse(final['default_changed'])
        self.assertFalse(final['execution_authorized']);self.assertEqual(final['tools_executed'], 0)

    def test_truncated_warmup_still_closes_owned_worker(self):
        closed = Mock()
        client = SimpleNamespace(close=closed, process=SimpleNamespace(poll=lambda: 0, pid=123))
        def digest(path): return probe.MODEL_SHA if path.suffix == '.gguf' else 'a' * 64
        with patch.object(sys, 'argv', ['probe']), patch.object(probe, 'digest', side_effect=digest), \
             patch.object(probe, 'WorkerClient', return_value=client), \
             patch.object(probe, 'generate', return_value={'metrics': {'finish_reason': 'length'}}), \
             self.assertRaisesRegex(ValueError, 'warmup truncated'): probe.main()
        closed.assert_called_once()


if __name__ == '__main__': unittest.main()
