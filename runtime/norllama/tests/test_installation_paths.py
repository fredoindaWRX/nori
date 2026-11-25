import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from installation_paths import runtime_installation


class RuntimeInstallationTests(unittest.TestCase):
    def test_source_and_frozen_follow_same_relocated_suite(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary).resolve() / "relocated-Nori"
            directory = root / "runtime" / "norllama"
            expected = (root, directory / "config.json")
            self.assertEqual(runtime_installation(directory / "norllama.py", frozen=False), expected)
            self.assertEqual(runtime_installation(Path(temporary) / "extracted" / "norllama.py",
                             frozen=True, executable=directory / "NorLlama.exe"), expected)

    def test_wrong_or_relative_layout_is_refused(self):
        with self.assertRaisesRegex(ValueError, "absolute"):
            runtime_installation("runtime/norllama/norllama.py", frozen=False)
        with tempfile.TemporaryDirectory() as temporary:
            with self.assertRaisesRegex(ValueError, "installed"):
                runtime_installation(Path(temporary) / "norllama.py", frozen=False)
            with self.assertRaisesRegex(ValueError, "installed"):
                runtime_installation(Path(temporary) / "runtime/norllama/norllama.py",
                                     frozen=True, executable=Path(temporary) / "NorLlama.exe")


if __name__ == "__main__":
    unittest.main()
