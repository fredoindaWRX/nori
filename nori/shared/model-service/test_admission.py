"""Unit tests for NORI's conservative local-model admission plan."""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from adapters import GiB, MiB, memory_plan

class ModelAdmissionPlanTests(unittest.TestCase):
    def test_small_model_is_admitted_with_real_headroom(self):
        plan = memory_plan(105 * MiB, {'available_bytes': 4 * GiB})
        self.assertEqual(plan['decision'], 'admitted')
        self.assertGreater(plan['headroom_bytes'], 0)
        self.assertGreater(plan['estimated_required_bytes'], plan['model_file_bytes'])

    def test_large_model_is_rejected_before_engine_start(self):
        plan = memory_plan(8 * GiB, {'available_bytes': 8 * GiB})
        self.assertEqual(plan['decision'], 'rejected_insufficient_available_ram')
        self.assertLess(plan['headroom_bytes'], 0)

    def test_unknown_measurement_is_not_silently_admitted(self):
        plan = memory_plan(105 * MiB, {'available_bytes': None})
        self.assertEqual(plan['decision'], 'measurement_unavailable')
        self.assertIsNone(plan['headroom_bytes'])

    def test_invalid_model_size_is_rejected(self):
        with self.assertRaises(ValueError):
            memory_plan(0, {'available_bytes': 8 * GiB})

if __name__ == '__main__':
    unittest.main()
