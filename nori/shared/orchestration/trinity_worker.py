"""NORI-native local plugin registry for the Trinity Knight.

Plugins stay inside a configured local root and declare a small NORI manifest.
Discovery reads metadata only. Invocation requires an isolated backend, so
plugin code is never imported into the Council's privileged Python process.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any
from uuid import uuid4

from audit.nori_audit import record
from permissions.nori_policy import Policy
from security.hard_floor import HardFloorViolation, assert_file_allowed, assert_output_safe, require_isolated_execution
from orchestration.workspace_paths import reject_link


class TrinityWorker:
    def __init__(self, root: Path, policy: Policy, audit_path: Path):
        self.root = Path(root).resolve()
        self.policy = policy
        self.audit_path = Path(audit_path)

    def _plugin(self, plugin_id: object) -> tuple[dict, Path]:
        if not isinstance(plugin_id, str) or not plugin_id or len(plugin_id) > 64:
            raise ValueError("plugin id is invalid")
        if any(character not in "abcdefghijklmnopqrstuvwxyz0123456789_-" for character in plugin_id):
            raise ValueError("plugin id is invalid")
        directory = self.root / plugin_id
        reject_link(directory)
        directory = directory.resolve()
        if self.root not in directory.parents or directory == self.root:
            raise ValueError("plugin must remain in the plugin root")
        manifest_path = directory / "nori-plugin.json"
        entry = directory / "plugin.py"
        reject_link(manifest_path)
        reject_link(entry)
        manifest_path = manifest_path.resolve()
        entry = entry.resolve()
        if directory not in manifest_path.parents or directory not in entry.parents:
            raise HardFloorViolation("plugin_file_path_escape")
        assert_file_allowed(manifest_path, operation="read")
        assert_file_allowed(entry, operation="read")
        if not manifest_path.is_file() or not entry.is_file():
            raise ValueError("plugin is missing manifest or entrypoint")
        if manifest_path.stat().st_size > 16 * 1024 or entry.stat().st_size > 256 * 1024:
            raise ValueError("plugin is too large")
        with manifest_path.open('rb') as stream:
            raw = stream.read(16 * 1024 + 1)
        if len(raw) > 16 * 1024:
            raise ValueError('plugin manifest grew beyond size limit')
        content = raw.decode('utf-8')
        assert_output_safe(content)
        manifest = json.loads(content)
        if (not isinstance(manifest, dict) or set(manifest) != {"schema", "id", "version", "capabilities"}
                or manifest["schema"] != 1 or manifest["id"] != plugin_id
                or not isinstance(manifest["version"], str) or not manifest["version"]
                or not isinstance(manifest["capabilities"], list) or not manifest["capabilities"]
                or any(not isinstance(value, str) or not value for value in manifest["capabilities"])):
            raise ValueError("plugin manifest is invalid")
        return manifest, entry

    def list(self) -> dict:
        decision = self.policy.decide('plugin_execute')
        if not decision.allowed:
            return {'status':'denied','reason':decision.reason}
        if not self.root.is_dir():
            return {"status": "completed", "plugins": []}
        plugins = []
        for directory in sorted(self.root.iterdir()):
            try:
                reject_link(directory)
                if not directory.is_dir():
                    continue
                manifest, _ = self._plugin(directory.name)
                plugins.append({key: manifest[key] for key in ("id", "version", "capabilities")})
            except (ValueError, HardFloorViolation, json.JSONDecodeError):
                continue
        return {"status": "completed", "plugins": plugins}

    def invoke(self, plugin_id: object, request: object) -> dict:
        if not isinstance(request, dict) or len(repr(request).encode("utf-8")) > 16 * 1024:
            raise ValueError("plugin request is invalid")
        task_id = str(uuid4())
        try:
            return self._invoke(plugin_id, request, task_id)
        except HardFloorViolation as error:
            reason = str(error)
            record(self.audit_path, "trinity_plugin", task_id, "denied", {"reason": reason})
            return {"status": "denied", "task_id": task_id, "reason": reason}

    def _invoke(self, plugin_id: object, request: dict, task_id: str) -> dict:
        decision = self.policy.decide("plugin_execute")
        if not decision.allowed:
            record(self.audit_path, "trinity_plugin", task_id, "denied", {"reason": decision.reason})
            return {"status": "denied", "task_id": task_id, "reason": decision.reason}
        manifest, _ = self._plugin(plugin_id)
        require_isolated_execution("python_plugin")
        raise HardFloorViolation("isolated_execution_backend_unavailable")

    def run(self, request: dict[str, Any]) -> dict:
        if not isinstance(request, dict) or not isinstance(request.get("operation"), str):
            raise ValueError("trinity request is invalid")
        if request["operation"] == "list" and set(request) == {"operation"}:
            return self.list()
        if request["operation"] == "invoke" and set(request) == {"operation", "plugin", "request"}:
            return self.invoke(request["plugin"], request["request"])
        raise ValueError("trinity request is invalid")
