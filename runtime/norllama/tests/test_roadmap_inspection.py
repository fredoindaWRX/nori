import builtins
import ast
import importlib.util
import inspect
from pathlib import Path
import unittest
from unittest.mock import patch, Mock

spec = importlib.util.spec_from_file_location("roadmap_inspection_fixture",
    Path(__file__).resolve().parents[3] / "nori/roadmap_status.py")
roadmap = importlib.util.module_from_spec(spec)
spec.loader.exec_module(roadmap)


class RoadmapInspectionTests(unittest.TestCase):
    def test_default_inspection_never_dispatches_active_verifiers(self):
        self.assertIs(inspect.signature(roadmap.write_report).parameters["run_checks"].default, False)
        verifier = Mock(return_value=(True, "synthetic fixture passed"))
        with patch.object(roadmap, "_EVIDENCE", {"fixture": (("source",), ("test",))}), \
             patch.object(roadmap, "_RUNTIME_VERIFIERS", {"fixture": verifier}), \
             patch.object(roadmap, "_exists", return_value=True):
            inspection = roadmap.report()
            verifier.assert_not_called()
            self.assertEqual(inspection["subsystems"][0]["deterministic_check_status"], "NOT_RUN")
            checked = roadmap.report(run_checks=True)
            verifier.assert_called_once()
            self.assertEqual(checked["subsystems"][0]["deterministic_check_status"], "PASS")
            self.assertEqual(checked["subsystems"][0]["end_to_end_status"], "UNVERIFIED")
            self.assertEqual(checked["end_to_end_summary"]["verified"], 0)
            self.assertFalse(checked["completion_proven"])
            verifier.return_value = (False, "fixture check failed")
            failed = roadmap.report(run_checks=True)
            self.assertEqual(failed["deterministic_check_summary"]["failed"], 1)
            self.assertEqual(failed["subsystems"][0]["end_to_end_status"], "UNVERIFIED")

    def test_routine_diagnostics_do_not_opt_into_legacy_active_checks(self):
        source = Path(__file__).resolve().parents[3] / "nori/diagnostics.py"
        tree = ast.parse(source.read_text(encoding="utf-8"))
        calls = [node for node in ast.walk(tree) if isinstance(node, ast.Call)
                 and isinstance(node.func, ast.Name) and node.func.id == "roadmap_report"]
        self.assertTrue(calls)
        for call in calls:
            options = {keyword.arg: keyword.value for keyword in call.keywords}
            self.assertIsInstance(options.get("run_checks"), ast.Constant)
            self.assertIs(options["run_checks"].value, False)

    def test_memory_inspection_does_not_import_or_mutate_active_legacy_store(self):
        attempted = []
        original = builtins.__import__

        def guarded(name, *arguments, **keywords):
            if name in {"memory_v2", "cortana_core_db"}:
                attempted.append(name)
                raise AssertionError("Active memory import is forbidden for this inspection")
            return original(name, *arguments, **keywords)

        with patch.object(builtins, "__import__", side_effect=guarded):
            verified, explanation = roadmap._verify_memory_context()
        self.assertFalse(verified)
        self.assertIn("not probed", explanation)
        self.assertEqual(attempted, [])
