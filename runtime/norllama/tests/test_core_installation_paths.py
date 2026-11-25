import importlib.util
from pathlib import Path
import tempfile
import unittest
import sys
import subprocess
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("nori_core_installation_paths",
    Path(__file__).resolve().parents[3] / "nori" / "nori_installation_paths.py")
paths = importlib.util.module_from_spec(spec)
spec.loader.exec_module(paths)


class CoreInstallationTests(unittest.TestCase):
    def test_actual_cli_entrypoints_do_not_require_project_working_directory(self):
        suite = Path(__file__).resolve().parents[3]
        with tempfile.TemporaryDirectory() as temporary:
            for arguments, expected in (
                ([str(suite / "nori/main.py"), "--config", str(suite / "nori/config.native-suite.json"), "--check"],
                 "Validated twelve Knights and unique ports"),
                ([str(suite / "runtime/norllama/norllama.py"), "--help"],
                 "Nori-owned authenticated loopback runtime"),
            ):
                completed = subprocess.run([sys.executable, "-B", *arguments], cwd=temporary,
                    capture_output=True, text=True, timeout=15, check=False,
                    creationflags=subprocess.CREATE_NO_WINDOW if sys.platform == "win32" else 0)
                self.assertEqual(completed.returncode, 0, completed.stderr)
                self.assertIn(expected, completed.stdout)
            self.assertEqual(list(Path(temporary).iterdir()), [], "CLI inspection must not create local state")

    def test_source_location_is_preserved(self):
        root = Path(__file__).resolve().parents[3] / "nori"
        self.assertEqual(paths.core_installation_root(root, frozen=False), root)

    def test_frozen_core_and_runtime_find_same_suite_resources(self):
        with tempfile.TemporaryDirectory() as temporary:
            suite = Path(temporary).resolve() / "moved-suite"
            extracted = Path(temporary) / "extraction" / "nori"
            for executable in (suite / "nori" / "NoriCore.exe",
                               suite / "runtime" / "norllama" / "NorLlama.exe"):
                self.assertEqual(paths.core_installation_root(extracted, frozen=True,
                                 executable=executable), suite / "nori")

    def test_invalid_layouts_fail(self):
        with self.assertRaisesRegex(ValueError, "absolute"):
            paths.core_installation_root("nori", frozen=False)
        with tempfile.TemporaryDirectory() as temporary:
            with self.assertRaisesRegex(ValueError, "outside"):
                paths.core_installation_root(Path(temporary), frozen=True,
                    executable=Path(temporary) / "NoriCore.exe")

    def test_prompt_loader_reads_installed_resources_in_simulated_frozen_mode(self):
        source = Path(__file__).resolve().parents[3] / "nori"
        with tempfile.TemporaryDirectory() as temporary:
            core = Path(temporary).resolve() / "relocated" / "nori"
            prompts = core / "prompts"
            prompts.mkdir(parents=True)
            (prompts / "covenant.md").write_text("[Name]: [owner fingerprint]", encoding="utf-8")
            (prompts / "autonomy.md").write_text("installed autonomy", encoding="utf-8")
            loader = importlib.util.spec_from_file_location("frozen_covenant_fixture", source / "prompts/covenant.py")
            covenant = importlib.util.module_from_spec(loader)
            with patch.object(sys, "path", [str(source), *sys.path]), \
                 patch.object(sys, "frozen", True, create=True), \
                 patch.object(sys, "executable", str(core / "NoriCore.exe")):
                loader.loader.exec_module(covenant)
            self.assertEqual(covenant.ROOT, prompts)
            rendered = covenant.build_system_prompt("neo", "coding")
            self.assertIn("Neo: owner pending activation", rendered)
            self.assertIn("installed autonomy", rendered)
            (prompts / "covenant.md").unlink()
            with self.assertRaises(FileNotFoundError):
                covenant.build_system_prompt("neo", "coding")
