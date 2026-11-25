"""NORI-native local code navigation worker for the Morpheus Knight.

This is NORI's own bounded project inspector.  It deliberately does not depend
on an editor extension, a network service, or a hosted code index.
"""

from __future__ import annotations

import re
from pathlib import Path
from typing import Any
from uuid import uuid4

from audit.nori_audit import record
from permissions.nori_policy import Policy
from security.hard_floor import HardFloorViolation, assert_output_safe
from orchestration.workspace_paths import reject_link, workspace_path


SOURCE_SUFFIXES = frozenset({".py", ".js", ".ts", ".tsx", ".jsx", ".cs", ".cpp", ".c", ".h", ".hpp", ".java", ".go", ".rs", ".lua", ".html", ".css", ".json", ".md", ".yml", ".yaml"})
SYMBOL_PATTERN = re.compile(r"^\s*(?:def|class|function|interface|struct|enum|fn|func)\s+([A-Za-z_][A-Za-z0-9_]*)")


class MorpheusWorker:
    def __init__(self, root: Path, policy: Policy, audit_path: Path):
        self.root = Path(root).resolve()
        self.policy = policy
        self.audit_path = Path(audit_path)

    def _allow(self, task_id: str, details: dict[str, Any]) -> dict | None:
        decision = self.policy.decide("ide_read")
        if decision.allowed:
            return None
        record(self.audit_path, "morpheus_ide", task_id, "denied", {**details, "reason": decision.reason})
        return {"status": "denied", "task_id": task_id, "reason": decision.reason}

    def _files(self) -> list[Path]:
        if not self.root.is_dir():
            return []
        files = []
        for path in self.root.rglob("*"):
            if len(files) >= 500:
                break
            reject_link(path)
            if path.is_file() and path.suffix.lower() in SOURCE_SUFFIXES and path.stat().st_size <= 512 * 1024:
                files.append(workspace_path(self.root, path.relative_to(self.root).as_posix()))
        return sorted(files)

    def _relative(self, value: object) -> Path:
        return workspace_path(self.root, value)

    def _read_text(self, path: Path) -> str:
        admitted = workspace_path(self.root, path.relative_to(self.root).as_posix())
        with admitted.open('rb') as handle:
            data = handle.read(512 * 1024 + 1)
        if len(data) > 512 * 1024:
            raise ValueError('Navigation source grew beyond size limit')
        content = data.decode('utf-8', errors='replace').replace('\r\n', '\n').replace('\r', '\n')
        assert_output_safe(content)
        return content

    def run(self, request: dict[str, Any]) -> dict:
        if not isinstance(request, dict) or not isinstance(request.get("operation"), str):
            raise ValueError("morpheus request is invalid")
        task_id = str(uuid4())
        try:
            return self._run(request, task_id)
        except HardFloorViolation as error:
            reason = str(error)
            record(self.audit_path, "morpheus_ide", task_id, "denied", {"operation": request["operation"], "reason": reason})
            return {"status": "denied", "task_id": task_id, "reason": reason}

    def _run(self, request: dict[str, Any], task_id: str) -> dict:
        operation = request["operation"]
        if operation == "search" and set(request) == {"operation", "query"}:
            query = request["query"]
            if not isinstance(query, str) or not query.strip() or len(query) > 120:
                raise ValueError("search query is invalid")
            denied = self._allow(task_id, {"operation": operation})
            if denied:
                return denied
            needle = query.casefold()
            matches = []
            for path in self._files():
                for line_number, line in enumerate(self._read_text(path).splitlines(), 1):
                    if needle in line.casefold():
                        matches.append({"path": path.relative_to(self.root).as_posix(), "line": line_number, "text": line[:240]})
                        if len(matches) >= 100:
                            break
                if len(matches) >= 100:
                    break
            record(self.audit_path, "morpheus_ide", task_id, "completed", {"operation": operation, "matches": len(matches)})
            return {"status": "completed", "task_id": task_id, "matches": matches}
        if operation == "symbols" and set(request) == {"operation", "path"}:
            path = self._relative(request["path"])
            denied = self._allow(task_id, {"operation": operation, "path": path.relative_to(self.root).as_posix()})
            if denied:
                return denied
            if not path.is_file() or path.suffix.lower() not in SOURCE_SUFFIXES or path.stat().st_size > 512 * 1024:
                raise ValueError("source file is unavailable")
            symbols = []
            for line_number, line in enumerate(self._read_text(path).splitlines(), 1):
                match = SYMBOL_PATTERN.match(line)
                if match:
                    symbols.append({"name": match.group(1), "line": line_number})
            relative = path.relative_to(self.root).as_posix()
            record(self.audit_path, "morpheus_ide", task_id, "completed", {"operation": operation, "path": relative, "symbols": len(symbols)})
            return {"status": "completed", "task_id": task_id, "path": relative, "symbols": symbols}
        raise ValueError("morpheus request is invalid")
