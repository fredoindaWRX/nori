"""Cline CLI adapter for bounded, evidence-producing development work."""
from __future__ import annotations

import asyncio
import json
import os
import shutil
import time
from pathlib import Path
from typing import Dict, Iterable, Optional

from .base import (
    DevelopmentWorkerAdapter,
    DispatchMode,
    WorkOrder,
    WorkResult,
    WorkerHealth,
    WorkerMetadata,
)


_IGNORED_PARTS = {
    ".git", ".pytest_cache", "__pycache__", "node_modules", ".venv", "venv",
    "runtime-data", "Logs", "data", "presence",
}
_IGNORED_FILES = {"service_state.json"}
_MAX_EVIDENCE_FILE_BYTES = 8 * 1024 * 1024


class ClineAdapter(DevelopmentWorkerAdapter):
    """Run Cline non-interactively while Nori owns scope, policy, and proof."""

    def __init__(
        self,
        workspace_root: Path,
        executable: str = "cline",
        data_dir: Optional[Path] = None,
        provider: Optional[str] = None,
        model: Optional[str] = None,
        priority: int = 20,
    ):
        metadata = WorkerMetadata(
            worker_id="cline-cli",
            provider="cline",
            dispatch_mode=DispatchMode.DIRECT,
            capabilities=["coding", "refactoring", "testing", "planning"],
            task_types=["implementation", "bugfix", "verification"],
            local_or_remote=False,
            priority=priority,
        )
        super().__init__(metadata)
        self.workspace_root = Path(workspace_root).resolve()
        self.executable = executable
        self.data_dir = Path(data_dir).resolve() if data_dir else None
        self.provider = provider
        self.model = model
        self._current_process: Optional[asyncio.subprocess.Process] = None

    async def get_status(self) -> WorkerMetadata:
        command = shutil.which(self.executable)
        if not command:
            self.metadata.health = WorkerHealth.UNAVAILABLE
            return self.metadata
        try:
            process = await asyncio.create_subprocess_exec(
                command, "doctor",
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            stdout, stderr = await asyncio.wait_for(process.communicate(), timeout=15)
            output = (stdout + stderr).decode("utf-8", errors="replace").lower()
            if process.returncode == 0 and "hub healthy" in output:
                self.metadata.health = WorkerHealth.HEALTHY
            elif "auth" in output:
                self.metadata.health = WorkerHealth.AUTH_REQUIRED
            else:
                self.metadata.health = WorkerHealth.DEGRADED
        except (OSError, asyncio.TimeoutError):
            self.metadata.health = WorkerHealth.UNAVAILABLE
        return self.metadata

    def _inside_workspace(self, path: Path) -> Path:
        resolved = Path(path).resolve()
        if resolved != self.workspace_root and self.workspace_root not in resolved.parents:
            raise ValueError(f"Path is outside the Nori workspace: {resolved}")
        return resolved

    def _snapshot(self) -> Dict[Path, tuple[int, int]]:
        """Capture cheap mutation metadata; content is hashed only for receipts."""
        evidence: Dict[Path, tuple[int, int]] = {}
        for root, dirs, files in os.walk(self.workspace_root):
            dirs[:] = [name for name in dirs if name not in _IGNORED_PARTS]
            root_path = Path(root)
            for name in files:
                if name in _IGNORED_FILES:
                    continue
                path = root_path / name
                try:
                    stat = path.stat()
                    if path.is_symlink() or stat.st_size > _MAX_EVIDENCE_FILE_BYTES:
                        continue
                    evidence[path.resolve()] = (stat.st_size, stat.st_mtime_ns)
                except OSError:
                    continue
        return evidence

    @staticmethod
    def _changes(before: Dict[Path, tuple[int, int]], after: Dict[Path, tuple[int, int]]) -> list[Path]:
        return sorted(
            path for path in before.keys() | after.keys()
            if before.get(path) != after.get(path)
        )

    def _prompt(self, order: WorkOrder, allowed: Iterable[Path]) -> str:
        paths = "; ".join(str(path) for path in sorted(allowed))
        context = "; ".join(str(self._inside_workspace(path)) for path in order.context_files)
        return (
            "NORI BOUNDED WORK ORDER. "
            f"Task ID={order.task_id}; "
            f"GOAL={order.original_goal}; "
            f"CURRENT STATE={order.current_state}; "
            f"NEXT ACTION={order.next_action}; "
            f"ACCEPTANCE CRITERIA={order.acceptance_criteria}; "
            f"MODIFY ONLY={paths or 'none (read-only task)'}; "
            f"READ CONTEXT={context or 'none'}; "
            "Do not publish, deploy, spend money, contact people, change credentials or "
            "permissions, install software, or access secrets. Stop if any of those actions "
            "would be required. Run relevant verification and report concrete evidence. "
            "EXECUTE THE GOAL NOW. Do not ask what to implement: the GOAL, NEXT ACTION, "
            "allowed paths, and acceptance criteria above are the complete work order."
        )

    async def dispatch(self, order: WorkOrder) -> WorkResult:
        allowed = {self._inside_workspace(path) for path in order.allowed_files}
        allowed.update(self._inside_workspace(path) for path in order.bounded_scope)
        before = await asyncio.to_thread(self._snapshot)
        command = shutil.which(self.executable)
        if not command:
            return WorkResult(False, "", "Cline CLI is not installed", [], -1, "UNAVAILABLE")

        cmd = [
            command,
            "--json",
            "--auto-approve", "true",
            "--compaction", "agentic",
            "--retries", "3",
            "--timeout", str(max(1, int(order.timeout_seconds))),
            "--cwd", str(self.workspace_root),
        ]
        if self.data_dir:
            self.data_dir.mkdir(parents=True, exist_ok=True)
            cmd.extend(["--data-dir", str(self.data_dir)])
        if self.provider:
            cmd.extend(["--provider", self.provider])
        if self.model:
            cmd.extend(["--model", self.model])
        cmd.append(self._prompt(order, allowed))

        self.metadata.busy = True
        self.metadata.current_task = order.task_id
        started = time.time()
        try:
            self._current_process = await asyncio.create_subprocess_exec(
                *cmd,
                cwd=str(self.workspace_root),
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            try:
                stdout, stderr = await asyncio.wait_for(
                    self._current_process.communicate(),
                    timeout=order.timeout_seconds + 10,
                )
            except asyncio.TimeoutError:
                await self.cancel(order.task_id)
                return WorkResult(False, "", "Cline timed out", [], -1, "TIMEOUT")

            after = await asyncio.to_thread(self._snapshot)
            changed = self._changes(before, after)
            unauthorized = [path for path in changed if path not in allowed]
            out = stdout.decode("utf-8", errors="replace")
            err = stderr.decode("utf-8", errors="replace")
            combined = (out + "\n" + err).casefold()
            if "unauthorized" in combined or "re-authenticate" in combined or "authentication required" in combined:
                self.metadata.health = WorkerHealth.AUTH_REQUIRED
                self.metadata.waiting_for_auth = True
                self.metadata.last_failure = time.time()
                return WorkResult(
                    False, out, err or "Cline authentication is required", changed,
                    self._current_process.returncode or 1, "AUTH_REQUIRED",
                )
            if "insufficient balance" in combined or "quota exhausted" in combined or "quota_exhausted" in combined:
                self.metadata.health = WorkerHealth.QUOTA_EXHAUSTED
                self.metadata.usage_exhausted = True
                self.metadata.last_failure = time.time()
                return WorkResult(
                    False, out, err or "Cline provider quota is exhausted", changed,
                    self._current_process.returncode or 1, "QUOTA_EXHAUSTED",
                )
            if unauthorized:
                detail = json.dumps([str(path) for path in unauthorized], ensure_ascii=False)
                return WorkResult(
                    False, out, f"Cline changed files outside its authorized scope: {detail}",
                    changed, self._current_process.returncode or 1, "SCOPE_VIOLATION",
                )
            success = self._current_process.returncode == 0
            if success and allowed and not changed:
                self.metadata.last_failure = time.time()
                return WorkResult(
                    False, out,
                    "Cline exited without producing the required file-change evidence",
                    changed, 1, "INCOMPLETE",
                )
            if success:
                self.metadata.health = WorkerHealth.HEALTHY
                self.metadata.waiting_for_auth = False
                self.metadata.last_success = time.time()
            else:
                self.metadata.last_failure = time.time()
            return WorkResult(success, out, err, changed, self._current_process.returncode or 0)
        except OSError as error:
            self.metadata.last_failure = time.time()
            return WorkResult(False, "", str(error), [], -1, "INTERNAL_ERROR")
        finally:
            self.metadata.busy = False
            self.metadata.current_task = None
            self._current_process = None
            _ = started

    async def cancel(self, task_id: str) -> bool:
        process = self._current_process
        if not process or process.returncode is not None:
            return False
        try:
            process.terminate()
            await asyncio.wait_for(process.wait(), timeout=5)
            return True
        except asyncio.TimeoutError:
            process.kill()
            await process.wait()
            return True
        except OSError:
            return False
