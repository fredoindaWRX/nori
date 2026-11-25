"""Tool configuration must never stand in for actual backend acceptance."""
from pathlib import Path
import sys
import unittest
from unittest.mock import patch

sys.path.insert(0,str(Path(__file__).resolve().parents[3]/'nori'))
from tool_capabilities import inventory


class ToolQualificationTests(unittest.TestCase):
    def test_configuration_alone_is_not_ready_evidence(self):
        with patch('tool_capabilities.editor_status',return_value={'status':'synthetic'}):
            for configured,status in [(False,'unavailable'),(True,'not_evaluated')]:
                result=inventory(configured)
                qualification=result['isolated_execution_qualification']
                self.assertEqual(result['isolated_runner_configured'],configured)
                self.assertEqual(qualification['status'],status)
                self.assertFalse(qualification['ready_verified'])
