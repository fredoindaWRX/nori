"""Runtime service authority for the local NORI desktop.

This module is the single source of truth for the root service-manager wrapper.
It starts local services without console windows, reports current process state,
and keeps the launcher-facing API small and stable.
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import psutil


DEFAULT_ROOT = Path(r"C:\Nori")
CHECK_INTERVAL = 5.0


@dataclass(frozen=True)
class ServiceSpec:
    name: str
    script: Path
    args: tuple[str, ...] = ()
    required: bool = True
    working_directory: Path | None = None

    def command(self, python: Path) -> list[str]:
        return [str(python), str(self.script), *self.args]


class RuntimeServiceAuthority:
    """Owns NORI's local runtime process lifecycle."""

    def __init__(self, root: Path | str = DEFAULT_ROOT, check_interval: float = CHECK_INTERVAL):
        self.root = Path(root)
        self.check_interval = float(check_interval)
        self.log_dir = self.root / "logs"
        self.state_file = self.root / "service_state.json"
        self.services = self._service_specs()

    def _python_background(self) -> Path:
        executable = Path(sys.executable)
        pythonw = executable.with_name("pythonw.exe")
        if pythonw.exists():
            return pythonw
        return executable

    def _creationflags(self) -> int:
        return int(getattr(subprocess, "CREATE_NO_WINDOW", 0))

    def _service_environment(self) -> dict[str, str]:
        env = dict(os.environ)
        token_path = self.root / "nori" / "runtime-data" / "secrets" / "council-token"
        if not env.get("NORI_API_TOKEN") and token_path.is_file():
            try:
                token = token_path.read_text(encoding="utf-8").strip()
            except OSError:
                token = ""
            if len(token) >= 32:
                env["NORI_API_TOKEN"] = token
        return env

    def _service_specs(self) -> list[ServiceSpec]:
        return [
            ServiceSpec(
                name="council",
                script=self.root / "nori" / "main.py",
                working_directory=self.root / "nori",
            ),
            ServiceSpec(
                name="workspace",
                script=self.root / "workspace" / "server.py",
                working_directory=self.root / "workspace",
            ),
            ServiceSpec(
                name="presence_awareness",
                script=self.root / "presence_agent.py",
                args=("watch",),
                working_directory=self.root,
            ),
        ]

    def _log(self, event: str, details: dict[str, Any] | None = None) -> None:
        self.log_dir.mkdir(parents=True, exist_ok=True)
        record = {"time": time.time(), "event": event, "details": details or {}}
        with (self.log_dir / "service-manager.jsonl").open("a", encoding="utf-8") as handle:
            handle.write(json.dumps(record, ensure_ascii=False) + "\n")

    def _cmdline_text(self, process: psutil.Process) -> str:
        try:
            return " ".join(process.info.get("cmdline") or []).casefold()
        except (psutil.NoSuchProcess, psutil.AccessDenied, psutil.ZombieProcess):
            return ""

    def _arg_matches_script(self, argument: str, script: Path) -> bool:
        normalized = str(argument or "").strip("\"'").replace("/", "\\").casefold()
        target = str(script).replace("/", "\\").casefold()
        if normalized == target:
            return True
        return Path(normalized).name == script.name.casefold()

    def script_processes(self, script: Path | str) -> list[dict[str, Any]]:
        target = Path(script)
        matches: list[dict[str, Any]] = []
        for process in psutil.process_iter(["pid", "name", "cmdline", "create_time"]):
            command_line = process.info.get("cmdline") or []
            if any(self._arg_matches_script(argument, target) for argument in command_line):
                matches.append(
                    {
                        "pid": process.info.get("pid"),
                        "name": process.info.get("name"),
                        "create_time": process.info.get("create_time"),
                        "cmdline": process.info.get("cmdline"),
                    }
                )
        return matches

    def _service_spec_by_name(self, name: str | None) -> ServiceSpec | None:
        target = str(name or "").strip().casefold()
        for spec in self.services:
            if spec.name.casefold() == target:
                return spec
        return None

    def start_service(self, spec: ServiceSpec | str) -> dict[str, Any]:
        if isinstance(spec, str):
            found = self._service_spec_by_name(spec)
            if found is None:
                return {"success": False, "name": spec, "error": "service_not_found"}
            spec = found
        if not spec.script.exists():
            result = {"success": False, "name": spec.name, "error": f"script_missing:{spec.script}"}
            self._log("service_start_failed", result)
            return result
        if self.script_processes(spec.script.name):
            return {"success": True, "name": spec.name, "already_running": True}
        try:
            process = subprocess.Popen(
                spec.command(self._python_background()),
                cwd=str(spec.working_directory or self.root),
                stdin=subprocess.DEVNULL,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                env=self._service_environment(),
                creationflags=self._creationflags(),
            )
        except Exception as exc:
            result = {"success": False, "name": spec.name, "error": f"{type(exc).__name__}: {exc}"}
            self._log("service_start_failed", result)
            return result
        result = {"success": True, "name": spec.name, "pid": process.pid, "started": True}
        self._log("service_started", result)
        return result

    def stop_service(self, spec: ServiceSpec | str, timeout_seconds: float = 5.0) -> dict[str, Any]:
        if isinstance(spec, str):
            found = self._service_spec_by_name(spec)
            if found is None:
                return {"success": False, "name": spec, "error": "service_not_found"}
            spec = found
        stopped: list[int] = []
        errors: list[dict[str, Any]] = []
        for item in self.script_processes(spec.script.name):
            pid = item.get("pid")
            if not pid:
                continue
            try:
                process = psutil.Process(int(pid))
                process.terminate()
                try:
                    process.wait(timeout=float(timeout_seconds))
                except psutil.TimeoutExpired:
                    process.kill()
                    process.wait(timeout=2.0)
                stopped.append(int(pid))
            except psutil.NoSuchProcess:
                stopped.append(int(pid))
            except Exception as exc:
                errors.append({"pid": pid, "error": f"{type(exc).__name__}: {exc}"})
        result = {"success": not errors, "name": spec.name, "stopped_pids": stopped, "errors": errors}
        self._log("service_stopped", result)
        return result

    def restart_service(self, service_name: str) -> dict[str, Any]:
        spec = self._service_spec_by_name(service_name)
        if spec is None:
            return {
                "success": False,
                "name": service_name,
                "error": "service_not_found",
                "available_services": [item.name for item in self.services],
            }
        stopped = self.stop_service(spec)
        if not stopped.get("success"):
            return {"success": False, "name": spec.name, "stop": stopped, "start": None}
        time.sleep(0.2)
        started = self.start_service(spec)
        return {
            "success": bool(started.get("success")),
            "name": spec.name,
            "stop": stopped,
            "start": started,
            "status": self._status_for(spec),
        }

    def ensure_services(self) -> list[dict[str, Any]]:
        return [self.start_service(spec) for spec in self.services if spec.required]

    def _status_for(self, spec: ServiceSpec) -> dict[str, Any]:
        processes = self.script_processes(spec.script.name)
        # A Windows pythonw launcher can re-exec the same script under the
        # selected interpreter. Report that launcher/worker pair as one
        # service instance instead of showing a false duplicate.
        roots: list[dict[str, Any]] = []
        process_ids = {int(item['pid']) for item in processes if item.get('pid')}
        for item in processes:
            pid = item.get('pid')
            parent = None
            if pid:
                try:
                    parent = psutil.Process(int(pid)).ppid()
                except (psutil.NoSuchProcess, psutil.AccessDenied, psutil.ZombieProcess):
                    parent = None
            if parent in process_ids:
                continue
            roots.append(item)
        return {
            "name": spec.name,
            "script": str(spec.script),
            "required": spec.required,
            "running": bool(roots),
            "processes": roots,
            "process_count": len(roots),
        }

    def get_status(self) -> dict[str, Any]:
        services = [self._status_for(spec) for spec in self.services]
        return {
            "success": True,
            "checked_at": time.time(),
            "services": services,
            "all_required_running": all(item["running"] for item in services if item["required"]),
        }

    def status_snapshot(self) -> dict[str, Any]:
        return self.get_status()

    def _write_state(self, snapshot: dict[str, Any]) -> None:
        try:
            self.state_file.write_text(json.dumps(snapshot, indent=2, ensure_ascii=False), encoding="utf-8")
        except Exception:
            pass

    def watch(self) -> None:
        self._log("watchdog_started", {"interval_seconds": self.check_interval})
        while True:
            self.ensure_services()
            snapshot = self.status_snapshot()
            self._write_state(snapshot)
            time.sleep(self.check_interval)
