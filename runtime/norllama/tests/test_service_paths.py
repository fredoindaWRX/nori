from pathlib import Path
import sys
import tempfile
import unittest
sys.path.insert(0, str(Path(__file__).resolve().parents[3] / 'nori'))
from tools.service_manager import ServiceManager


class ServicePathsTests(unittest.TestCase):
    def test_interpreters_and_service_paths_follow_explicit_root(self):
        with tempfile.TemporaryDirectory(prefix='nori-service-paths-') as folder:
            root = Path(folder)
            manager = ServiceManager(root)
            for service in manager.services.values():
                expected = root / 'nori' / '.venv-architect' / 'Scripts' / 'python.exe'
                self.assertEqual(Path(service['start_cmd'][0]), expected)
                self.assertTrue(service['work_dir'].is_relative_to(root))
            self.assertFalse(manager.pid_file.exists())
