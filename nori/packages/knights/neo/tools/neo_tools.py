"""NORI Neo's local MCP-shaped tool definitions.

The tools are intentionally local and shell-free. They wrap NORI's native
NeoWorker where possible, then provide a small Git and validation surface for
software-engineering work. They are not browser, research, identity, or
security tools.
"""
from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
import sys
from typing import Any, Callable

_SHARED = Path(__file__).resolve().parents[4] / "shared"
if str(_SHARED) not in sys.path:
    sys.path.insert(0, str(_SHARED))

from audit.nori_audit import record
from orchestration.neo_worker import NeoWorker
from permissions.nori_policy import Policy
from security.hard_floor import load_hard_floor, require_isolated_execution

FORBIDDEN_PARTS = frozenset({"sentinel", "identity", "key", "keys", "tpm", "recovery", "permissions"})


@dataclass(frozen=True)
class McpToolDefinition:
    """Framework-neutral definition that can be registered with an MCP host."""

    name: str
    description: str
    input_schema: dict[str, Any]
    handler: Callable[..., dict[str, Any]]


def _safe_relative(value: str) -> str:
    candidate = Path(value)
    if candidate.is_absolute() or ".." in candidate.parts or not value.strip():
        raise ValueError("neo_path_outside_workspace")
    if any(part.casefold() in FORBIDDEN_PARTS for part in candidate.parts):
        raise PermissionError("neo_boundary_protected_system")
    return candidate.as_posix()


class NeoTools:
    """Local repository tools owned by the Neo Knight."""

    def __init__(self, workspace_root: Path, audit_path: Path, grants: tuple[str, ...] | list[str]):
        load_hard_floor()
        self.workspace_root = Path(workspace_root).resolve()
        self.audit_path = Path(audit_path)
        self.policy = Policy(grants)
        self.worker = NeoWorker(self.workspace_root, self.policy, self.audit_path)

    def _run(self, command: list[str], *, cwd: Path | None = None) -> dict[str, Any]:
        if not command or any(not isinstance(part, str) or not part for part in command):
            raise ValueError("neo_invalid_command")
        # Git can launch configured helpers; pytest imports arbitrary project
        # code. Shell-free processes still inherit the host's authority.
        require_isolated_execution("neo_subprocess")

    def read_file(self, *, path: str) -> dict[str, Any]:
        return self.worker.run({"operation": "read", "path": _safe_relative(path)})

    def write_file(self, *, path: str, content: str, approved: bool) -> dict[str, Any]:
        return self.worker.run({"operation": "write", "path": _safe_relative(path),
                                "content": content, "approved": approved})

    def search_code(self, *, query: str) -> dict[str, Any]:
        return self.worker.run({"operation": "search", "query": query})

    def list_symbols(self, *, path: str) -> dict[str, Any]:
        return self.worker.run({"operation": "symbols", "path": _safe_relative(path)})

    def git_status(self) -> dict[str, Any]:
        result = self._run(["git", "status", "--short"])
        record(self.audit_path, "neo_git", "status", result["status"], {"returncode": result["returncode"]})
        return result

    def git_diff(self, *, path: str | None = None) -> dict[str, Any]:
        command = ["git", "diff", "--"]
        if path is not None:
            command.append(_safe_relative(path))
        result = self._run(command)
        record(self.audit_path, "neo_git", "diff", result["status"], {"returncode": result["returncode"]})
        return result

    def run_tests(self, *, path: str = "tests") -> dict[str, Any]:
        relative = _safe_relative(path)
        result = self._run([sys.executable, "-m", "pytest", relative])
        record(self.audit_path, "neo_terminal", "pytest", result["status"], {"path": relative, "returncode": result["returncode"]})
        return result

    def compile_file(self, *, path: str) -> dict[str, Any]:
        relative = _safe_relative(path)
        source = self.worker.run({"operation": "read", "path": relative})
        if source["status"] != "completed":
            return source
        try:
            # Compile only the bounded, inspected source already read by Neo.
            # Never execute it, import project code, or create a .pyc file.
            compile(source["content"], relative, "exec", dont_inherit=True)
            result = {"status": "completed", "path": relative, "validation": "python_syntax_only"}
        except (SyntaxError, ValueError, OverflowError) as error:
            result = {"status": "failed", "path": relative, "validation": "python_syntax_only",
                      "error_type": type(error).__name__}
        record(self.audit_path, "neo_validation", "compile", result["status"], {"path": relative})
        return result

    def definitions(self) -> tuple[McpToolDefinition, ...]:
        return (
            McpToolDefinition("neo_read_file", "Read an approved workspace file.", {"path": "string"}, self.read_file),
            McpToolDefinition("neo_write_file", "Write an approved workspace file when the caller sets approved=true.", {"path": "string", "content": "string", "approved": "boolean"}, self.write_file),
            McpToolDefinition("neo_search_code", "Search the indexed source workspace.", {"query": "string"}, self.search_code),
            McpToolDefinition("neo_list_symbols", "List code symbols from a source file.", {"path": "string"}, self.list_symbols),
            McpToolDefinition("neo_git_status", "Git status requires an isolated runner, currently unavailable.", {}, self.git_status),
            McpToolDefinition("neo_git_diff", "Git diff requires an isolated runner, currently unavailable.", {"path": "string?"}, self.git_diff),
            McpToolDefinition("neo_run_tests", "Test execution requires an isolated runner, currently unavailable.", {"path": "string"}, self.run_tests),
            McpToolDefinition("neo_compile_file", "Check Python syntax without executing code or writing bytecode.", {"path": "string"}, self.compile_file),
        )
