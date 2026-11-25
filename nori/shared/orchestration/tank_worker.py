"""NORI-native Tank hardware capability surface.

Tank begins with an auditable read-only hardware inventory. Device control is
deliberately not implied by a profile snapshot; protocol adapters must be
implemented and authorized independently.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any
from uuid import uuid4

from audit.nori_audit import record
from hardware.nori_hal import snapshot
from hardware.device_drivers import DriverCatalog
from hardware.network_devices import MapSnapshotStore, NetworkDeviceRegistry
from hardware.home_assistant import HomeAssistant
from hardware.openclaw_mcp import LocalToolBridge
from hardware.vacuum_scanner import VacuumScanner
from permissions.nori_policy import Policy


class TankWorker:
    def __init__(self, policy: Policy, audit_path: Path, sensory=None, driver_catalog=None,
                 recording_root=None, network_devices=None, map_snapshot_root=None,
                 home_assistant=None, tool_bridge=None, vacuum_scanner=None):
        self.policy = policy
        self.audit_path = Path(audit_path)
        self.sensory = sensory
        self.driver_catalog = driver_catalog or DriverCatalog()
        self.network_devices = network_devices or NetworkDeviceRegistry(policy)
        # Runtime data belongs beside this worker's audit log, not beside the
        # installed Python package (which may live under Program Files).
        data_root = self.audit_path.parent
        self.map_snapshots = MapSnapshotStore(
            map_snapshot_root or data_root / 'network-map-snapshots'
        )
        self.recording_root = Path(recording_root or data_root / 'scanner-import').resolve()
        self.home_assistant = home_assistant or HomeAssistant()
        self.tool_bridge = tool_bridge or LocalToolBridge()
        self.vacuum_scanner = vacuum_scanner or VacuumScanner(self.home_assistant)

    def run(self, request: dict[str, Any]) -> dict[str, Any]:
        if request == {"operation": "home_status"}:
            task_id = str(uuid4())
            decision = self.policy.decide("home_read")
            if not decision.allowed:
                record(self.audit_path, "tank_home_status", task_id, "denied", {"reason": decision.reason})
                return {"status": "denied", "reason": decision.reason}
            result = self.home_assistant.status()
            record(self.audit_path, "tank_home_status", task_id, "completed", {
                "configured": result.get("configured") is True, "trusted": result.get("trusted") is True})
            return {"status": "completed", "task_id": task_id, "home": result}
        if isinstance(request, dict) and request.get("operation") == "home_get_state":
            if set(request) != {"operation", "entity_id"}:
                raise ValueError("Home state request fields are invalid")
            decision = self.policy.decide("home_read")
            if not decision.allowed:
                return {"status": "denied", "reason": decision.reason}
            task_id = str(uuid4())
            result = self.home_assistant.get_state(request["entity_id"])
            status = "completed" if result.get("success") else "unavailable"
            record(self.audit_path, "tank_home_read", task_id, status, {
                "entity_id": str(request["entity_id"]), "error": result.get("error")})
            return {"status": status, "task_id": task_id, "home": result}
        if isinstance(request, dict) and request.get("operation") == "home_set_light":
            if set(request) - {"operation", "entity_id", "on", "brightness_percent", "rgb_color"}:
                raise ValueError("Home light request fields are invalid")
            if not isinstance(request.get("on"), bool):
                raise ValueError("Home light on must be boolean")
            decision = self.policy.decide("home_control")
            if not decision.allowed:
                return {"status": "denied", "reason": decision.reason}
            task_id = str(uuid4())
            result = self.home_assistant.set_light(
                request.get("entity_id"), on=request["on"],
                brightness_percent=request.get("brightness_percent"),
                rgb_color=request.get("rgb_color"),
            )
            status = "completed" if result.get("verified") else "failed"
            record(self.audit_path, "tank_home_light", task_id, status, {
                "entity_id": str(request.get("entity_id")), "verified": result.get("verified") is True,
                "mismatches": result.get("mismatches", [])})
            return {"status": status, "task_id": task_id, "home": result}
        if isinstance(request, dict) and request.get("operation") == "home_set_switch":
            if set(request) != {"operation", "entity_id", "on"}:
                raise ValueError("Home switch request fields are invalid")
            if not isinstance(request.get("on"), bool):
                raise ValueError("Home switch on must be boolean")
            decision = self.policy.decide("home_control")
            if not decision.allowed:
                return {"status": "denied", "reason": decision.reason}
            task_id = str(uuid4())
            result = self.home_assistant.set_switch(request["entity_id"], on=request["on"])
            status = "completed" if result.get("verified") else "failed"
            record(self.audit_path, "tank_home_switch", task_id, status, {
                "entity_id": str(request["entity_id"]), "verified": result.get("verified") is True,
                "mismatches": result.get("mismatches", [])})
            return {"status": status, "task_id": task_id, "home": result}
        if isinstance(request, dict) and request.get("operation") == "home_vacuum_command":
            if set(request) != {"operation", "entity_id", "command"}:
                raise ValueError("Home vacuum request fields are invalid")
            decision = self.policy.decide("home_control")
            if not decision.allowed:
                return {"status": "denied", "reason": decision.reason}
            task_id = str(uuid4())
            ha_status = self.home_assistant.status()
            if ha_status.get("configured") and ha_status.get("trusted"):
                result = self.home_assistant.vacuum_command(
                    request["entity_id"], command=request["command"])
            else:
                # Fallback to multi-protocol discovery and local execution
                bind_res = self.vacuum_scanner.discover_and_bind(request["entity_id"])
                if bind_res.get("status") == "bound" and bind_res.get("adapter"):
                    adapter = bind_res["adapter"]
                    cmd_result = adapter.command(request["command"])
                    status_after = adapter.status() if hasattr(adapter, "status") else {}
                    # An acknowledgement alone is not physical-state verification.
                    expected_states = {
                        "start": {"cleaning", "on"},
                        "stop": {"idle", "docked", "off"},
                        "pause": {"paused"},
                        "return_to_base": {"returning", "docked"},
                        "dock": {"returning", "docked"},
                    }
                    acknowledged = (
                        isinstance(cmd_result, dict)
                        and cmd_result.get("ok") is not False
                        and cmd_result.get("success") is not False
                        and (cmd_result.get("ok") is True
                             or cmd_result.get("success") is True
                             or cmd_result.get("accepted") is True
                             or cmd_result.get("accepted") == request["command"])
                    )
                    actual_state = (str(status_after.get("state", "")).casefold()
                                    if isinstance(status_after, dict) else "")
                    verified = acknowledged and actual_state in expected_states.get(request["command"], set())
                    result = {
                        "success": verified,
                        "verified": verified,
                        "entity_id": request["entity_id"],
                        "command": request["command"],
                        "mismatches": [] if verified else ["command_or_state"],
                        "protocol": bind_res.get("protocol"),
                        "after": status_after,
                    }
                else:
                    result = {
                        "success": False,
                        "verified": False,
                        "entity_id": request["entity_id"],
                        "error": "home_assistant_unconfigured_and_local_discovery_failed",
                        "mismatches": ["state"],
                    }
            status = "completed" if result.get("verified") else "failed"
            record(self.audit_path, "tank_home_vacuum", task_id, status, {
                "entity_id": str(request.get("entity_id")),
                "command": str(request.get("command")),
                "verified": result.get("verified") is True,
                "mismatches": result.get("mismatches", [])})
            return {"status": status, "task_id": task_id, "home": result}
        if request == {"operation": "tool_bridge_status"}:
            task_id = str(uuid4())
            decision = self.policy.decide("tool_bridge_read")
            if not decision.allowed:
                record(self.audit_path, "tank_tool_bridge_status", task_id, "denied", {"reason": decision.reason})
                return {"status": "denied", "reason": decision.reason}
            result = self.tool_bridge.status()
            record(self.audit_path, "tank_tool_bridge_status", task_id, "completed", {
                "configured": result.get("configured") is True, "trusted": result.get("trusted") is True})
            return {"status": "completed", "task_id": task_id, "bridge": result}
        if request == {"operation": "tool_bridge_list_tools"}:
            task_id = str(uuid4())
            decision = self.policy.decide("tool_bridge_read")
            if not decision.allowed:
                return {"status": "denied", "reason": decision.reason}
            result = self.tool_bridge.list_tools()
            status = "completed" if result.get("success") else "unavailable"
            record(self.audit_path, "tank_tool_bridge_list", task_id, status, {"error": result.get("error")})
            return {"status": status, "task_id": task_id, "bridge": result}
        if isinstance(request, dict) and request.get("operation") == "tool_bridge_call":
            if set(request) - {"operation", "tool", "arguments", "approved"}:
                raise ValueError("Tool bridge call request fields are invalid")
            tool = request.get("tool")
            kind = self.tool_bridge.tool_kind(tool) if isinstance(tool, str) else None
            if kind is None:
                return {"status": "denied", "reason": "tool_not_allowlisted"}
            action = "tool_bridge_read" if kind == "read" else "tool_bridge_act"
            decision = self.policy.decide(action, bool(request.get("approved", False)))
            if not decision.allowed:
                return {"status": "denied", "reason": decision.reason, "requires_approval": decision.requires_approval}
            task_id = str(uuid4())
            result = self.tool_bridge.call_tool(tool, request.get("arguments", {}))
            status = "completed" if result.get("success") else "failed"
            record(self.audit_path, "tank_tool_bridge_call", task_id, status, {
                "tool": tool, "kind": kind, "error": result.get("error")})
            return {"status": status, "task_id": task_id, "bridge": result}
        if isinstance(request, dict) and request.get('operation') == 'vehicle_self_test':
            if set(request) != {'operation', 'recording_path'} or not isinstance(request['recording_path'], str):
                raise ValueError('Vehicle self-test requires operation and recording_path')
            task_id = str(uuid4())
            decision = self.policy.decide('hardware_read')
            if not decision.allowed:
                record(self.audit_path, 'tank_vehicle_test', task_id, 'denied', {'reason': decision.reason})
                return {'status': 'denied', 'task_id': task_id, 'reason': decision.reason}
            source = (self.recording_root / request['recording_path']).resolve()
            try:
                source.relative_to(self.recording_root)
            except ValueError as exc:
                raise ValueError('Recording must be inside the scanner import folder') from exc
            if not source.is_file() or source.stat().st_size > 20 * 1024 * 1024:
                raise ValueError('Recording is unavailable or exceeds 20 MB')
            from vehicle_self_test import analyze_recording
            result = analyze_recording(source.read_bytes())
            record(self.audit_path, 'tank_vehicle_test', task_id, 'completed', {
                'source': str(source.relative_to(self.recording_root)),
                'samples': result['sample_count'], 'findings': len(result['findings'])
            })
            return {'status': 'completed', 'task_id': task_id, 'self_test': result}
        if request == {"operation": "driver_catalog"}:
            task_id = str(uuid4())
            decision = self.policy.decide("hardware_read")
            if not decision.allowed:
                record(self.audit_path, "tank_drivers", task_id, "denied", {"reason": decision.reason})
                return {"status": "denied", "task_id": task_id, "reason": decision.reason}
            result = self.driver_catalog.status()
            record(self.audit_path, "tank_drivers", task_id, "completed", {
                "providers": len(result["providers"]), "protocols": len(result["protocols"])
            })
            return {"status": "completed", "task_id": task_id, "catalog": result}
        if isinstance(request, dict) and request.get("operation") == "network_device_catalog":
            if set(request) != {"operation"}:
                raise ValueError("Network device catalog requires operation only")
            decision = self.policy.decide("hardware_read")
            if not decision.allowed:
                return {"status": "denied", "reason": decision.reason}
            return {"status": "completed", "catalog": self.network_devices.status()}
        if isinstance(request, dict) and request.get("operation") == "network_device_read":
            if set(request) != {"operation", "device_id", "read"}:
                raise ValueError("Network device read fields are invalid")
            decision = self.policy.decide("hardware_read")
            if not decision.allowed:
                return {"status": "denied", "reason": decision.reason}
            return {
                "status": "completed",
                "device_id": request["device_id"],
                "read": request["read"],
                "result": self.network_devices.read(request["device_id"], request["read"]),
            }
        if isinstance(request, dict) and request.get("operation") == "network_device_map_snapshot":
            if set(request) - {"operation", "device_id", "captured_at"}:
                raise ValueError("Network device map snapshot fields are invalid")
            if not isinstance(request.get("device_id"), str):
                raise ValueError("Network device map snapshot device ID is invalid")
            captured_at = request.get("captured_at")
            if captured_at is not None and not isinstance(captured_at, str):
                raise ValueError("Network device map snapshot timestamp is invalid")
            decision = self.policy.decide("hardware_read")
            if not decision.allowed:
                return {"status": "denied", "reason": decision.reason}
            return {
                "status": "completed",
                "device_id": request["device_id"],
                "snapshot": self.network_devices.capture_map(
                    request["device_id"], self.map_snapshots, captured_at
                ),
            }
        if isinstance(request, dict) and request.get("operation") == "network_device_command":
            if set(request) - {"operation", "device_id", "command", "approved"}:
                raise ValueError("Network device command fields are invalid")
            if not isinstance(request.get("approved", False), bool):
                raise ValueError("Network device approval is invalid")
            return {
                "status": "completed",
                "device_id": request["device_id"],
                "command": request["command"],
                "result": self.network_devices.command(
                    request["device_id"], request["command"], request["approved"]
                ),
            }
        if isinstance(request, dict) and request.get('operation') == 'query_senses':
            if set(request) != {'operation', 'type'}:
                raise ValueError('Sensory query requires operation and type')
            decision = self.policy.decide('hardware_read')
            if not decision.allowed:
                record(self.audit_path, 'tank_sensory', str(uuid4()), 'denied', {})
                return {'status': 'denied', 'reason': decision.reason}
            if self.sensory is None:
                return {'status': 'unavailable', 'reason': 'sensory_layer_not_configured'}
            result = self.sensory.query(request['type'])
            record(self.audit_path, 'tank_sensory', str(uuid4()), 'completed', {'type': request['type']})
            return {'status': 'completed', 'snapshot': result}
        if not isinstance(request, dict) or set(request) != {"operation"}:
            raise ValueError("tank request is invalid")
        if request["operation"] != "hardware_snapshot":
            raise ValueError("tank operation is invalid")
        task_id = str(uuid4())
        decision = self.policy.decide("hardware_read")
        if not decision.allowed:
            record(self.audit_path, "tank_hardware", task_id, "denied", {"reason": decision.reason})
            return {"status": "denied", "task_id": task_id, "reason": decision.reason}
        result = snapshot()
        # The boundary should not overstate the GPU hint as a detected device.
        if not isinstance(result, dict) or not isinstance(result.get("profile"), dict) or not isinstance(result.get("tier"), str):
            record(self.audit_path, "tank_hardware", task_id, "failed", {"reason": "invalid_hal_response"})
            raise ValueError("hardware profile is invalid")
        record(self.audit_path, "tank_hardware", task_id, "completed", {"tier": result["tier"]})
        return {"status": "completed", "task_id": task_id, "profile": result}
