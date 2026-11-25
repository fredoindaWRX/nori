from pathlib import Path
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / 'nori/shared'))
from runtime.core_readiness import evaluate
from orchestration.knight_registry import EXPECTED_KNIGHTS


class ReadinessRosterTests(unittest.TestCase):
    def test_canonical_roster_reports_presence_not_functional_qualification(self):
        result = evaluate(ROOT / 'nori', {})
        self.assertEqual(set(result['native_knights']), EXPECTED_KNIGHTS)
        self.assertTrue(all(item['source_present'] for item in result['native_knights'].values()))
        self.assertTrue(all(item['functional_qualification'] == 'not_evaluated'
                            for item in result['native_knights'].values()))
        self.assertFalse(result['release_verified'])
        self.assertEqual(result['assessment_scope'], 'source_inventory_and_configuration_only')

    def test_empty_root_cannot_pass_native_roster(self):
        with tempfile.TemporaryDirectory(dir=ROOT / 'verification') as directory:
            result = evaluate(Path(directory), {})
            self.assertIn('native_knight_sources', result['blocking_missing_components'])
            self.assertFalse(any(item['source_present'] for item in result['native_knights'].values()))


if __name__ == '__main__': unittest.main()
