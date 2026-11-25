"""Aider adapter for non-interactive coding tasks."""
from __future__ import annotations

import asyncio
import subprocess
import logging
from pathlib import Path
from typing import List, Optional
from .base import (
    DevelopmentWorkerAdapter, 
    WorkerMetadata, 
    WorkerHealth, 
    DispatchMode, 
    WorkOrder, 
    WorkResult
)

logger = logging.getLogger("nori.aider")

class AiderAdapter(DevelopmentWorkerAdapter):
    """
    Adapter for Aider CLI.
    Executable: C:\\Nori\\.venvs\\ai-stack\\Scripts\\aider.exe
    Model: ollama_chat/qwen2.5-coder:14b
    """
    
    def __init__(self, executable_path: Path, model: str):
        metadata = WorkerMetadata(
            worker_id="aider-local",
            provider="aider",
            dispatch_mode=DispatchMode.DIRECT,
            capabilities=["coding", "refactoring", "testing"],
            task_types=["implementation", "bugfix"],
            local_or_remote=True,
            priority=10  # High priority local fallback
        )
        super().__init__(metadata)
        self.executable_path = executable_path
        self.model = model
        self._current_process: Optional[asyncio.subprocess.Process] = None

    async def get_status(self) -> WorkerMetadata:
        # Aider is a local executable, so it's available unless the path is missing
        if not self.executable_path.exists():
            self.metadata.health = WorkerHealth.UNAVAILABLE
        else:
            self.metadata.health = WorkerHealth.HEALTHY
            
        return self.metadata

    async def dispatch(self, order: WorkOrder) -> WorkResult:
        """
        Runs aider in non-interactive mode using the --message flag.
        """
        self.metadata.busy = True
        try:
            # Build the command
            # --message: the prompt
            # --model: the model to use
            # --yes: auto-accept changes (non-interactive)
            # --no-git: we manage git/backups at the Nori level
            
            cmd = [
                str(self.executable_path),
                "--model", self.model,
                "--yes",
                "--no-git",
                "--message", order.original_goal
            ]
            
            # Add bounded files to the aider session
            for file_path in order.bounded_scope:
                cmd.append(str(file_path))

            logger.info(f"Dispatching to Aider: {order.original_goal}")
            
            process = await asyncio.create_subprocess_exec(
                *cmd,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE
            )
            self._current_process = process
            
            try:
                stdout, stderr = await asyncio.wait_for(process.communicate(), timeout=order.timeout_seconds)
                
                exit_code = process.returncode
                stdout_text = stdout.decode('utf-8', errors='replace')
                stderr_text = stderr.decode('utf-8', errors='replace')
                
                # detect changed files - in a real implementation, we'd use git diff or 
                # a snapshot of the directory before/after.
                changed_files = self._detect_changed_files(order.bounded_scope)
                
                return WorkResult(
                    success=(exit_code == 0),
                    stdout=stdout_text,
                    stderr=stderr_text,
                    changed_files=changed_files,
                    exit_code=exit_code
                )
                
            except asyncio.TimeoutError:
                await self.cancel(order.task_id)
                return WorkResult(
                    success=False, 
                    stdout="", 
                    stderr="Aider timed out", 
                    changed_files=[], 
                    exit_code=-1, 
                    error_type="TIMEOUT"
                )

        except Exception as e:
            logger.exception(f"Aider dispatch error: {e}")
            return WorkResult(
                success=False, 
                stdout="", 
                stderr=str(e), 
                changed_files=[], 
                exit_code=-1, 
                error_type="INTERNAL_ERROR"
            )
        finally:
            self.metadata.busy = False
            self._current_process = None

    async def cancel(self, task_id: str) -> bool:
        if self._current_process:
            try:
                self._current_process.terminate()
                return True
            except Exception:
                return False
        return False

    def _detect_changed_files(self, scope: List[Path]) -> List[Path]:
        # This is a placeholder. In a full implementation, we'd compare 
        # source hashes from the WorkOrder before and after.
        # For now, we return the scope as 'potentially changed'.
        return scope
