"""NORI Watchman: deterministic Robotics control admission gate.

Watchman is not a Knight and it does not drive a device.  It evaluates a small
typed command envelope before an eventual hardware adapter receives it.  The
adapter must independently enforce its own physical and firmware interlocks.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any
from uuid import uuid4

from audit.nori_audit import record
from permissions.nori_policy import Policy


COMMANDS = frozenset({"telemetry.read", "motion.stop", "motion.set", "actuator.set"})
ACTUATION = frozenset({"motion.set", "actuator.set"})
MAX_DEVICE_ID = 80


@dataclass
class ArmedDevice:
    capabilities: frozenset[str]


class Watchman:
    """Local, stateful admission gate for a future robotics device adapter."""

    def __init__(self, policy: Policy, audit_path: Path):
        self.policy = policy
        self.audit_path = Path(audit_path)
        self._armed: dict[str, ArmedDevice] = {}

    @staticmethod
    def _device(value: object) -> str:
        if not isinstance(value, str) or not value or len(value) > MAX_DEVICE_ID:
            raise ValueError("device id is invalid")
        if any(character not in "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789._-" for character in value):
            raise ValueError("device id is invalid")
        return value

    @staticmethod
    def _capabilities(value: object) -> frozenset[str]:
        if not isinstance(value, list) or not value or len(value) > len(ACTUATION):
            raise ValueError("capabilities are invalid")
        capabilities = frozenset(value)
        if len(capabilities) != len(value) or not capabilities <= ACTUATION:
            raise ValueError("capabilities are invalid")
        return capabilities

    def arm(self, device: object, capabilities: object, approved: object) -> dict[str, Any]:
        device = self._device(device)
        capabilities = self._capabilities(capabilities)
        task_id = str(uuid4())
        if approved is not True:
            record(self.audit_path, "watchman_arm", task_id, "denied", {"device": device, "reason": "explicit_approval_required"})
            return {"status": "denied", "task_id": task_id, "reason": "explicit_approval_required"}
        decision = self.policy.decide("robotics_arm", approved=approved is True)
        if not decision.allowed:
            record(self.audit_path, "watchman_arm", task_id, "denied", {"device": device, "reason": decision.reason})
            return {"status": "denied", "task_id": task_id, "reason": decision.reason}
        self._armed[device] = ArmedDevice(capabilities)
        record(self.audit_path, "watchman_arm", task_id, "armed", {"device": device, "capabilities": sorted(capabilities)})
        return {"status": "armed", "task_id": task_id, "device": device, "capabilities": sorted(capabilities)}

    def disarm(self, device: object) -> dict[str, Any]:
        device = self._device(device)
        task_id = str(uuid4())
        self._armed.pop(device, None)
        record(self.audit_path, "watchman_arm", task_id, "disarmed", {"device": device})
        return {"status": "disarmed", "task_id": task_id, "device": device}

    def admit(self, device: object, command: object, payload: object, approved: object = False) -> dict[str, Any]:
        device = self._device(device)
        if not isinstance(command, str) or command not in COMMANDS:
            raise ValueError("command is invalid")
        if not isinstance(payload, dict) or len(repr(payload).encode("utf-8")) > 4096:
            raise ValueError("command payload is invalid")
        task_id = str(uuid4())
        if command == "telemetry.read":
            decision = self.policy.decide("robotics_read")
        elif command == "motion.stop":
            # Stop is intentionally available without prior arming, but the
            # eventual adapter remains responsible for physical E-stop logic.
            decision = self.policy.decide("robotics_stop")
        else:
            if approved is not True:
                record(self.audit_path, "watchman_command", task_id, "denied", {"device": device, "command": command, "reason": "explicit_approval_required"})
                return {"status": "denied", "task_id": task_id, "reason": "explicit_approval_required"}
            decision = self.policy.decide("robotics_control", approved=approved is True)
            armed = self._armed.get(device)
            if decision.allowed and (armed is None or command not in armed.capabilities):
                record(self.audit_path, "watchman_command", task_id, "denied", {"device": device, "command": command, "reason": "device_not_armed_for_command"})
                return {"status": "denied", "task_id": task_id, "reason": "device_not_armed_for_command"}
        if not decision.allowed:
            record(self.audit_path, "watchman_command", task_id, "denied", {"device": device, "command": command, "reason": decision.reason})
            return {"status": "denied", "task_id": task_id, "reason": decision.reason}
        admitted = {"device": device, "command": command, "payload": dict(payload)}
        record(self.audit_path, "watchman_command", task_id, "admitted", {"device": device, "command": command})
        return {"status": "admitted", "task_id": task_id, "command": admitted}

    def run(self, request: dict[str, Any]) -> dict[str, Any]:
        if not isinstance(request, dict) or not isinstance(request.get("operation"), str):
            raise ValueError("watchman request is invalid")
        operation = request["operation"]
        if operation == "arm" and set(request) == {"operation", "device", "capabilities", "approved"}:
            return self.arm(request["device"], request["capabilities"], request["approved"])
        if operation == "disarm" and set(request) == {"operation", "device"}:
            return self.disarm(request["device"])
        if operation == "admit" and set(request) == {"operation", "device", "command", "payload", "approved"}:
            return self.admit(request["device"], request["command"], request["payload"], request["approved"])
        raise ValueError("watchman request is invalid")
