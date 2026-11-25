"""NORI-native task admission for the Smith Knight.

Python only runs through NORI's host-enforced NoriBuild sandbox.  There is no
same-user Windows subprocess fallback: without the configured runner, execution
remains denied.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any
from uuid import uuid4

from audit.nori_audit import record
from permissions.nori_policy import Policy
from security.hard_floor import HardFloorViolation, assert_file_allowed, require_isolated_execution
from orchestration.workspace_paths import workspace_path
from orchestration.wsl_python_runner import WslPythonRunner


class SmithWorker:
    def __init__(self, root: Path, policy: Policy, audit_path: Path, *, python_runner: WslPythonRunner | None = None):
        self.root = Path(root).resolve(); self.policy = policy; self.audit_path = Path(audit_path)
        # This type check prevents a caller from substituting a convenient
        # same-user process adapter for the isolated backend.
        if python_runner is not None and not isinstance(python_runner, WslPythonRunner):
            raise TypeError("python_runner must be NORI's WslPythonRunner")
        self.python_runner = python_runner

    def _path(self, value: object) -> tuple[Path, str]:
        path = workspace_path(self.root, value)
        return path, path.relative_to(self.root).as_posix()

    def run(self, request: dict[str, Any]) -> dict:
        if not isinstance(request, dict) or set(request) != {"operation", "path", "arguments", "timeout_seconds"} or request.get("operation") != "run_python":
            raise ValueError("smith request is invalid")
        task_id = str(uuid4())
        try:
            return self._run(request, task_id)
        except HardFloorViolation as error:
            reason = str(error)
            record(self.audit_path, "smith_execution", task_id, "denied", {"operation": "run_python", "reason": reason})
            return {"status": "denied", "task_id": task_id, "reason": reason}

    def _run(self, request: dict[str, Any], task_id: str) -> dict:
        path, relative = self._path(request["path"])
        arguments = request["arguments"]; timeout = request["timeout_seconds"]
        if (not isinstance(arguments, list) or len(arguments) > 16 or
                any(not isinstance(item, str) or len(item) > 160 for item in arguments)):
            raise ValueError("task arguments are invalid")
        if isinstance(timeout, bool) or not isinstance(timeout, int) or not 1 <= timeout <= 60:
            raise ValueError("task timeout is invalid")
        if not path.is_file() or path.suffix != ".py" or path.stat().st_size > 512 * 1024:
            raise ValueError("task file is unavailable")
        decision = self.policy.decide("execution_run")
        if not decision.allowed:
            record(self.audit_path, "smith_execution", task_id, "denied", {"path": relative, "reason": decision.reason})
            return {"status": "denied", "task_id": task_id, "reason": decision.reason}
        try:
            assert_file_allowed(path, operation="read")
            if self.python_runner is None:
                require_isolated_execution("python_script")
                raise HardFloorViolation("isolated_execution_backend_unavailable")
            result = self.python_runner.run(self.root, relative, arguments, timeout)
            if not isinstance(result, dict):
                raise HardFloorViolation("isolated_runner_result_invalid")
            if result.get("sandbox_stopped") is not True or result.get("cgroup_removed") is not True:
                raise HardFloorViolation("isolated_cleanup_unconfirmed")
            status = result.get("status")
            if status not in {"completed", "failed", "cancelled"}:
                raise HardFloorViolation("isolated_runner_result_invalid")
            record(self.audit_path, "smith_execution", task_id, status, {
                "path": relative,
                "backend": result.get("backend"),
                "exit_code": result.get("exit_code"),
                "executed": result.get("executed") is True,
            })
            return {**result, "task_id": task_id, "path": relative}
        except HardFloorViolation as error:
            reason = str(error)
            record(self.audit_path, "smith_execution", task_id, "denied", {"path": relative, "reason": reason})
            return {"status": "denied", "task_id": task_id, "reason": reason}
