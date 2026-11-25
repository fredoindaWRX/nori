"""Owner-enrolled network-device contracts for NORI.

Discovery is intentionally not a network scan. A device must be enrolled with
an owner-approved endpoint and a trusted adapter before NORI can query it.
Control is separate from observation and always requires explicit approval.
"""

from __future__ import annotations

from copy import deepcopy
from dataclasses import dataclass
from datetime import datetime, timezone
import json
import os
import re
from pathlib import Path
from tempfile import NamedTemporaryFile
from typing import Any, Callable
from urllib.parse import urlsplit
from urllib.parse import quote

from permissions.nori_policy import Policy


_ID = re.compile(r"[A-Za-z0-9][A-Za-z0-9_.-]{0,63}")
_ALLOWED_TYPES = frozenset({"vacuum", "light", "thermostat", "camera", "sensor"})
_READ_OPERATIONS = frozenset({"status", "map"})
_VACUUM_COMMANDS = frozenset({"start", "pause", "dock", "stop"})


def _endpoint(value: str) -> str:
    parsed = urlsplit(value)
    if (
        parsed.scheme not in {"http", "https"}
        or not parsed.hostname
        or parsed.username
        or parsed.password
        or parsed.path not in {"", "/"}
        or parsed.query
        or parsed.fragment
    ):
        raise ValueError("device endpoint must be a credential-free HTTP(S) base URL")
    return value.rstrip("/")


@dataclass(frozen=True)
class EnrolledDevice:
    id: str
    type: str
    endpoint: str
    adapter: str
    transport_verified: bool
    enabled: bool


class VacuumAdapter:
    """Typed adapter contract for a robot vacuum vendor bridge."""

    def __init__(self, transport: Callable[[str, str, dict[str, Any] | None], dict[str, Any]]):
        if not callable(transport):
            raise ValueError("vacuum transport is required")
        self._transport = transport

    def status(self) -> dict[str, Any]:
        return self._transport("GET", "/api/v1/status", None)

    def map(self) -> dict[str, Any]:
        return self._transport("GET", "/api/v1/map", None)

    def command(self, command: str) -> dict[str, Any]:
        if command not in _VACUUM_COMMANDS:
            raise ValueError("unsupported vacuum command")
        return self._transport("POST", "/api/v1/commands", {"command": command})


class HomeAssistantVacuumAdapter:
    """Read a vacuum entity through an owner-configured Home Assistant bridge."""

    _COMMAND_SERVICES = {
        "start": "start",
        "pause": "pause",
        "dock": "return_to_base",
        "stop": "stop",
    }

    def __init__(self, transport: Callable[[str, str, dict[str, Any] | None], dict[str, Any]],
                 entity_id: str):
        if not callable(transport) or not isinstance(entity_id, str) or not entity_id.startswith("vacuum."):
            raise ValueError("Home Assistant vacuum transport and entity are required")
        self._transport = transport
        self._entity_id = entity_id

    def status(self) -> dict[str, Any]:
        response = self._transport("GET", f"/api/states/{quote(self._entity_id, safe='.')}", None)
        if not isinstance(response, dict) or not isinstance(response.get("state"), str):
            raise ValueError("Home Assistant returned an invalid vacuum state")
        attributes = response.get("attributes", {})
        if not isinstance(attributes, dict):
            raise ValueError("Home Assistant returned invalid vacuum attributes")
        result = {"state": response["state"]}
        for key in ("battery_level", "fan_speed", "error"):
            if key in attributes:
                result[key] = deepcopy(attributes[key])
        return result

    def map(self) -> dict[str, Any]:
        response = self._transport("GET", f"/api/states/{quote(self._entity_id, safe='.')}", None)
        if not isinstance(response, dict) or not isinstance(response.get("attributes"), dict):
            raise ValueError("Home Assistant returned invalid vacuum map state")
        attributes = response["attributes"]
        map_data = attributes.get("map_data", attributes.get("map"))
        if not isinstance(map_data, dict):
            raise ValueError("Home Assistant vacuum entity does not expose map data")
        return deepcopy(map_data)

    def command(self, command: str) -> dict[str, Any]:
        service = self._COMMAND_SERVICES.get(command)
        if service is None:
            raise ValueError("unsupported vacuum command")
        return self._transport(
            "POST",
            f"/api/services/vacuum/{service}",
            {"entity_id": self._entity_id},
        )


_VACUUM_ADAPTERS = (VacuumAdapter, HomeAssistantVacuumAdapter)


class MapSnapshotStore:
    """Persist validated, read-only map snapshots one file per enrolled device."""

    def __init__(self, root: str | Path):
        self.root = Path(root).resolve()
        self.root.mkdir(parents=True, exist_ok=True)

    @staticmethod
    def _records(value: Any, field: str) -> list[dict[str, Any]]:
        if value is None:
            return []
        if not isinstance(value, list) or not all(isinstance(item, dict) for item in value):
            raise ValueError(f"map {field} must be a list of objects")
        return [deepcopy(item) for item in value]

    @classmethod
    def normalize(cls, device_id: str, payload: dict[str, Any],
                  captured_at: str | None = None) -> dict[str, Any]:
        if not isinstance(payload, dict):
            raise ValueError("device map must be an object")
        map_id = payload.get("map_id")
        revision = payload.get("revision")
        if not isinstance(map_id, str) or not map_id or len(map_id) > 128:
            raise ValueError("map_id must be a non-empty string")
        if type(revision) is not int or revision < 0:
            raise ValueError("map revision must be a non-negative integer")
        if captured_at is None:
            captured_at = datetime.now(timezone.utc).isoformat()
        try:
            parsed_time = datetime.fromisoformat(captured_at.replace("Z", "+00:00"))
        except (TypeError, ValueError) as exc:
            raise ValueError("captured_at must be an ISO-8601 timestamp") from exc
        if parsed_time.tzinfo is None:
            raise ValueError("captured_at must include a timezone")
        return {
            "device_id": device_id,
            "map_id": map_id,
            "revision": revision,
            "captured_at": captured_at,
            "rooms": cls._records(payload.get("rooms"), "rooms"),
            "obstacles": cls._records(payload.get("obstacles"), "obstacles"),
        }

    def _path(self, device_id: str) -> Path:
        if not isinstance(device_id, str) or not _ID.fullmatch(device_id):
            raise ValueError("map snapshot device ID is invalid")
        return self.root / f"{device_id}.json"

    def save(self, device_id: str, payload: dict[str, Any],
             captured_at: str | None = None) -> dict[str, Any]:
        snapshot = self.normalize(device_id, payload, captured_at)
        destination = self._path(device_id)
        with NamedTemporaryFile("w", encoding="utf-8", dir=self.root,
                                prefix=f".{device_id}.", suffix=".tmp", delete=False) as handle:
            temporary = Path(handle.name)
            json.dump(snapshot, handle, ensure_ascii=True, sort_keys=True, separators=(",", ":"))
            handle.write("\n")
        try:
            os.replace(temporary, destination)
        except Exception:
            temporary.unlink(missing_ok=True)
            raise
        return deepcopy(snapshot)

    def latest(self, device_id: str) -> dict[str, Any] | None:
        path = self._path(device_id)
        if not path.is_file():
            return None
        with path.open("r", encoding="utf-8") as handle:
            value = json.load(handle)
        if not isinstance(value, dict):
            raise ValueError("stored map snapshot must be an object")
        return self.normalize(device_id, value, value.get("captured_at"))


class NetworkDeviceRegistry:
    def __init__(self, policy: Policy, adapters: dict[str, Callable[[str], Any]] | None = None):
        self.policy = policy
        self._adapters = dict(adapters or {})
        self._devices: dict[str, EnrolledDevice] = {}

    def register_adapter(self, name: str, factory: Callable[[str], Any]) -> None:
        if not isinstance(name, str) or not _ID.fullmatch(name) or not callable(factory):
            raise ValueError("network adapter registration is invalid")
        self._adapters[name] = factory

    def enroll(self, manifest: dict[str, Any]) -> EnrolledDevice:
        required = {"id", "type", "endpoint", "adapter", "transport_verified", "enabled"}
        if not isinstance(manifest, dict) or set(manifest) != required:
            raise ValueError("network device manifest fields are invalid")
        device_id = manifest["id"]
        device_type = manifest["type"]
        adapter = manifest["adapter"]
        if (
            not isinstance(device_id, str)
            or not _ID.fullmatch(device_id)
            or device_id in self._devices
            or device_type not in _ALLOWED_TYPES
            or not isinstance(adapter, str)
            or adapter not in self._adapters
            or type(manifest["transport_verified"]) is not bool
            or type(manifest["enabled"]) is not bool
        ):
            raise ValueError("network device manifest values are invalid")
        enrolled = EnrolledDevice(
            device_id,
            device_type,
            _endpoint(manifest["endpoint"]),
            adapter,
            manifest["transport_verified"],
            manifest["enabled"],
        )
        self._devices[device_id] = enrolled
        return enrolled

    def status(self) -> dict[str, Any]:
        return {
            "devices": [
                {
                    "id": device.id,
                    "type": device.type,
                    "endpoint": device.endpoint,
                    "adapter": device.adapter,
                    "transport_verified": device.transport_verified,
                    "enabled": device.enabled,
                }
                for device in self._devices.values()
            ]
        }

    def _open(self, device_id: str) -> tuple[EnrolledDevice, Any]:
        device = self._devices.get(device_id)
        if device is None:
            raise LookupError("network device is not enrolled")
        if not device.enabled:
            raise PermissionError("network device is disabled")
        if not device.transport_verified:
            raise PermissionError("network transport is not verified")
        return device, self._adapters[device.adapter](device.endpoint)

    def read(self, device_id: str, operation: str) -> dict[str, Any]:
        if operation not in _READ_OPERATIONS:
            raise ValueError("unsupported network read operation")
        device, adapter = self._open(device_id)
        if device.type != "vacuum" or not isinstance(adapter, _VACUUM_ADAPTERS):
            raise ValueError("device does not provide the vacuum contract")
        result = adapter.status() if operation == "status" else adapter.map()
        if not isinstance(result, dict):
            raise ValueError("device returned an invalid response")
        return deepcopy(result)

    def capture_map(self, device_id: str, store: MapSnapshotStore,
                    captured_at: str | None = None) -> dict[str, Any]:
        if not isinstance(store, MapSnapshotStore):
            raise ValueError("map snapshot store is required")
        return store.save(device_id, self.read(device_id, "map"), captured_at)

    def command(self, device_id: str, command: str, approved: bool = False) -> dict[str, Any]:
        if not approved:
            return {"status": "denied", "reason": "explicit_approval_required"}
        decision = self.policy.decide("device_control", approved=approved)
        if not decision.allowed:
            return {"status": "denied", "reason": decision.reason}
        device, adapter = self._open(device_id)
        if device.type != "vacuum" or not isinstance(adapter, _VACUUM_ADAPTERS):
            raise ValueError("device does not provide the vacuum contract")
        result = adapter.command(command)
        if not isinstance(result, dict):
            raise ValueError("device returned an invalid response")
        return deepcopy(result)


def load_manifest(text: str) -> dict[str, Any]:
    value = json.loads(text)
    if not isinstance(value, dict):
        raise ValueError("network device manifest must be an object")
    return value
