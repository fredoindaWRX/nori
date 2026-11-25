from pathlib import Path
import sys
import tempfile
import unittest
sys.path.insert(0, str(Path(__file__).resolve().parents[3] / 'nori'))
from shared.runtime.core_readiness import evaluate


class HeartbeatReadinessTests(unittest.TestCase):
    def test_integrated_label_does_not_hide_missing_supervisor(self):
        with tempfile.TemporaryDirectory(prefix='nori-readiness-') as directory:
            report = evaluate(Path(directory), {'security': {
                'heartbeat_status': 'integrated', 'heartbeat_service': 'missing.py'}})
            self.assertEqual(report['components']['heartbeat_supervision']['status'], 'missing')
            self.assertIn('heartbeat_supervision', report['blocking_missing_components'])
            self.assertEqual(report['status'], 'incomplete')
    def test_source_presence_is_only_source_presence_not_live_supervision(self):
        root = Path(__file__).resolve().parents[3] / 'nori'
        report = evaluate(root, {'security': {'heartbeat_service': 'main.py'}})
        self.assertEqual(report['components']['heartbeat_supervision']['status'], 'present')
        self.assertNotIn('heartbeat_supervision', report['blocking_missing_components'])
