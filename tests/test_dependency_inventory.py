"""Dependency inventory checks for the Nori Core (Python side).

Companion to apps/desktop/tests/dependency-inventory.test.mjs. The JavaScript
gate checks the desktop tree; this checks the Python manifests and proves the
claim that CrewAI is not on the native path is true rather than assumed.
"""
from __future__ import annotations

import ast
import json
import sys
import unittest
from pathlib import Path

# C:\Nori\tests\test_dependency_inventory.py -> parents[0]=tests, [1]=C:\Nori
NORI_ROOT = Path(__file__).resolve().parents[1]
NORI_PKG = NORI_ROOT / "nori"
REGISTRY = NORI_ROOT / "tools" / "nori_deps" / "registry.json"

DEFAULT_REQUIREMENTS = NORI_PKG / "requirements.txt"
OPTIONAL_REQUIREMENTS = NORI_PKG / "requirements-optional-frameworks.txt"


def requirement_names(path: Path) -> set[str]:
    """Package names declared in a requirements file, ignoring comments."""
    names: set[str] = set()
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or line.startswith("-"):
            continue
        head = line.split(";")[0].strip()
        for separator in ("==", ">=", "<=", "~=", ">", "<", "[", " "):
            head = head.split(separator)[0]
        if head:
            names.add(head.strip())
    return names


def module_imports(path: Path) -> set[str]:
    """Top-level module names imported by a Python file, parsed not guessed."""
    tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
    found: set[str] = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for alias in node.names:
                found.add(alias.name.split(".")[0])
        elif isinstance(node, ast.ImportFrom):
            # Relative imports (level > 0) belong to Nori itself.
            if node.level == 0 and node.module:
                found.add(node.module.split(".")[0])
    return found


class DependencyManifestTests(unittest.TestCase):
    """The declared default install must not pull in an alternative framework."""

    def test_crewai_is_not_a_default_requirement(self) -> None:
        self.assertNotIn("crewai", requirement_names(DEFAULT_REQUIREMENTS))

    def test_crewai_remains_available_as_an_explicit_opt_in(self) -> None:
        # Removing it from the default install must not delete the adapters'
        # only dependency. Anyone relying on them must still be able to install.
        self.assertIn("crewai", requirement_names(OPTIONAL_REQUIREMENTS))

    def test_optional_file_documents_what_it_is_for(self) -> None:
        text = OPTIONAL_REQUIREMENTS.read_text(encoding="utf-8")
        self.assertIn("OPTIONAL", text)
        # It must state plainly that this is not the native path, so a future
        # reader does not mistake the file for part of the default install.
        self.assertIn("native", text.lower())

    def test_default_manifest_keeps_the_packages_that_are_actually_used(self) -> None:
        declared = requirement_names(DEFAULT_REQUIREMENTS)
        for keep in ("pytest", "PyYAML", "PyInstaller"):
            self.assertIn(keep, declared, f"{keep} is a real dependency")


class CrewAiIsNotOnTheNativePathTests(unittest.TestCase):
    """The claim in requirements.txt must be backed by the actual import graph."""

    # The modules the native Core really executes at startup.
    NATIVE_MODULES = (
        "shared/orchestration/architect_worker.py",
        "shared/orchestration/core_workers.py",
        "shared/orchestration/knight_service.py",
    )

    def test_native_orchestration_modules_do_not_import_crewai(self) -> None:
        for relative in self.NATIVE_MODULES:
            path = NORI_PKG / relative
            if not path.exists():
                continue
            self.assertNotIn("crewai", module_imports(path), f"{relative} imports crewai")

    def test_the_two_legacy_adapters_are_the_only_crewai_consumers(self) -> None:
        # Both must remain, because both still work: one is caller-supplied and
        # one is a lazy fallback behind an injected planner.
        neo = NORI_PKG / "packages/knights/neo/agents/neo.py"
        decomposer = (NORI_PKG / "packages/knights/architect/orchestration"
                      / "task_decomposer.py")
        self.assertIn("crewai", module_imports(neo))
        self.assertIn("crewai", module_imports(decomposer))

    def test_the_native_neo_agent_builds_without_crewai_installed(self) -> None:
        # Import the real module and confirm nothing pulls crewai in.
        sys.path.insert(0, str(NORI_PKG))
        try:
            sys.modules.pop("crewai", None)
            from packages.knights.neo.agents.neo import NeoAgent  # noqa: PLC0415

            agent = NeoAgent(
                workspace_root=NORI_ROOT,
                audit_path=NORI_ROOT / "scratch" / "_dep_audit.jsonl",
            )
            tools = agent.mcp_tools()
            self.assertGreater(len(tools), 0, "native MCP tool surface should exist")
            self.assertNotIn("crewai", sys.modules)
            self.assertEqual(
                agent.build_crewai_agent.__doc__.splitlines()[0].strip(),
                "Create the optional CrewAI adapter using the declared Devstral route.",
            )
        finally:
            if sys.path and sys.path[0] == str(NORI_PKG):
                sys.path.pop(0)


class RegistryTests(unittest.TestCase):
    """The registry must stay consistent with the manifests it describes."""

    def test_registry_is_valid_json_and_covers_both_manifests(self) -> None:
        registry = json.loads(REGISTRY.read_text(encoding="utf-8"))
        self.assertEqual(registry["schema"], "nori.dependency-registry.v1")
        self.assertIn("desktop", registry)
        self.assertIn("python", registry)

    def test_registry_records_crewai_as_removed_from_the_default_install(self) -> None:
        registry = json.loads(REGISTRY.read_text(encoding="utf-8"))
        removed = {entry["name"] for entry in registry["python"]["removed"]}
        self.assertIn("crewai", removed)

    def test_imported_model_weights_are_labelled_as_imported(self) -> None:
        registry = json.loads(REGISTRY.read_text(encoding="utf-8"))
        for entry in registry["modelWeights"]:
            self.assertIn(
                entry["identity"],
                {"IMPORTED THIRD-PARTY WEIGHTS", "NORI-CREATED EXPERIMENTAL WEIGHTS"},
                f"{entry['path']} must state its provenance",
            )
        imported = {e["path"] for e in registry["modelWeights"]
                    if e["identity"] == "IMPORTED THIRD-PARTY WEIGHTS"}
        # Whisper and Kokoro are imported algorithms, and saying so is the point.
        self.assertTrue(any("whisper" in p for p in imported))
        self.assertTrue(any("kokoro" in p for p in imported))


if __name__ == "__main__":
    unittest.main()