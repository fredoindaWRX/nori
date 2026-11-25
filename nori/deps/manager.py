"""Confirmation-gated, rollback-aware local dependency management."""
from __future__ import annotations

import importlib
from importlib import metadata
import re
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Callable, Iterable, Dict, List


@dataclass(frozen=True)
class PackageSpec:
    name: str
    version: str = ""
    import_name: str = ""


def _read_allowlist(path: Path) -> list[PackageSpec]:
    """Read the deliberately small YAML subset used by the allowlist."""
    result: list[PackageSpec] = []
    current: dict[str, str] | None = None
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or line == "packages:":
            continue
        if line.startswith("- "):
            if current and current.get("name"):
                result.append(PackageSpec(**current))
            current = {}
            line = line[2:].strip()
        if ":" in line and current is not None:
            key, value = line.split(":", 1)
            current[key.strip()] = value.strip().strip('"\'')
    if current and current.get("name"):
        result.append(PackageSpec(**current))
    return result


class DependencyManager:
    def __init__(self, allowlist: Path, runner: Callable[..., object] = subprocess.run,
                 importer: Callable[[str], object] = importlib.import_module,
                 logger: Callable[[str], None] | None = None,
                 version_getter: Callable[[str], str] = metadata.version):
        self.allowlist = Path(allowlist)
        self.runner = runner
        self.importer = importer
        self.logger = logger or (lambda _: None)
        self.version_getter = version_getter

    def _version_ok(self, spec: PackageSpec, *, require_metadata: bool = False) -> bool:
        if not spec.version:
            return True
        from packaging.specifiers import SpecifierSet
        from packaging.version import Version
        spec_set = SpecifierSet(spec.version)
        try:
            installed = self.version_getter(spec.name)
        except metadata.PackageNotFoundError:
            return False
        installed_version = Version(installed)
        if spec_set.contains(installed_version):
            return True
        return False

    def specs(self) -> list[PackageSpec]:
        specs = _read_allowlist(self.allowlist)
        # Version comparison relies on ``packaging.version``. Bootstrap it
        # before evaluating version-constrained dependencies so a fresh Nori
        # Python runtime can repair itself instead of failing midway through
        # the very dependency check that is meant to prepare it.
        return sorted(
            specs,
            key=lambda spec: (0 if spec.name.casefold() == "packaging" else 1, spec.name.casefold()),
        )

    def ensure(self) -> dict[str, str]:
        installed: list[str] = []
        for spec in self.specs():
            module = spec.import_name or spec.name.replace("-", "_")
            had_importable = False
            try:
                self.importer(module)
                had_importable = True
                if self._version_ok(spec):
                    continue
                self.logger(f"approved dependency version mismatch {spec.name}")
            except ImportError:
                pass
            requirement = spec.name + spec.version
            self.logger(f"installing approved dependency {requirement}")
            pip_completed = False
            try:
                self.runner([sys.executable, "-m", "pip", "install", requirement],
                            check=True, capture_output=True, text=True)
                pip_completed = True
                importlib.invalidate_caches()
                self.importer(module)
                if not self._version_ok(spec, require_metadata=True):
                    raise RuntimeError(f"installed version does not satisfy {requirement}")
                installed.append(spec.name)
                self.logger(f"dependency ready {spec.name}")
            except Exception as exc:
                self.logger(f"dependency failed {spec.name}: {exc}")
                # pip's --no-deps install transaction is not reversible, so remove
                # only a package this manager installed during this call.
                # Never remove a pre-existing installation just because an
                # upgrade/repair failed; rollback is limited to packages that
                # were absent before this ensure() call.
                if pip_completed and not had_importable:
                    self.runner([sys.executable, "-m", "pip", "uninstall", "-y", spec.name],
                                check=False, capture_output=True, text=True)
                raise RuntimeError(f"dependency unavailable: {spec.name}") from exc
        return {"result": "PASS", "installed": ",".join(installed)}

    def check(self) -> dict[str, object]:
        issues: Dict[str, str] = {}
        for spec in self.specs():
            try:
                installed = self.version_getter(spec.name)
                if not installed:
                    raise metadata.PackageNotFoundError(spec.name)
                if not self._version_ok(spec):
                    issues[spec.name] = f"version mismatch: {spec.version}"
            except metadata.PackageNotFoundError:
                issues[spec.name] = "missing distribution metadata"
            except (ValueError, TypeError) as exc:
                issues[spec.name] = f"invalid version metadata or rule: {exc}"
        if issues:
            return {"result": "FAIL", "issues": issues}
        return {"result": "PASS"}


def ensure(allowlist: Path | None = None) -> dict[str, str]:
    path = allowlist or Path(__file__).with_name("allowlist.yaml")
    return DependencyManager(path).ensure()
