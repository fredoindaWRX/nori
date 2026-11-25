from pathlib import Path
import sys
import unittest
from unittest.mock import patch
sys.path.insert(0, str(Path(__file__).resolve().parents[3] / 'nori'))
import tools


class ToolsPackageTests(unittest.TestCase):
    def test_independent_utilities_import_without_loading_missing_registry(self):
        with patch.object(tools, '_load_legacy_registry', side_effect=AssertionError('legacy touched')):
            from tools.service_manager import ServiceManager
            from tools.port_detector import PortDetector
            self.assertTrue(callable(ServiceManager))
            self.assertTrue(callable(PortDetector))
    def test_missing_registry_does_not_become_empty_or_permissive(self):
        with patch.object(tools, '_legacy_tools', None), patch.object(Path, 'is_file', return_value=False):
            with self.assertRaisesRegex(ImportError, 'has not been recovered'):
                tools._registry()
            self.assertIsNone(tools._legacy_tools)
    def test_capture_and_write_fail_without_registry(self):
        with patch.object(tools, '_legacy_tools', None), patch.object(Path, 'is_file', return_value=False):
            for call in [lambda: tools.create_text_file('fixture.txt', 'test'),
                         tools.capture_screen, tools.capture_camera]:
                with self.assertRaisesRegex(ImportError, 'unavailable'): call()
