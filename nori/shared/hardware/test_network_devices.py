import pytest

from hardware.network_devices import (
    HomeAssistantVacuumAdapter,
    MapSnapshotStore,
    NetworkDeviceRegistry,
    VacuumAdapter,
)
from orchestration.tank_worker import TankWorker
from permissions.nori_policy import Policy


class FakeVacuum:
    def __init__(self, endpoint):
        self.endpoint = endpoint
        self.calls = []

    def call(self, method, path, body):
        self.calls.append((method, path, body))
        if path.endswith("/map"):
            return {"map_id": "living-room", "revision": 1, "rooms": []}
        if path.endswith("/status"):
            return {"state": "docked", "battery": 87}
        return {"accepted": body["command"]}


def make_registry():
    devices = {}

    def factory(endpoint):
        fake = FakeVacuum(endpoint)
        devices["vacuum"] = fake
        return VacuumAdapter(fake.call)

    registry = NetworkDeviceRegistry(Policy(["hardware_read", "device_control"]))
    registry.register_adapter("test-vacuum", factory)
    registry.enroll({
        "id": "living-room-vacuum",
        "type": "vacuum",
        "endpoint": "http://192.168.1.50",
        "adapter": "test-vacuum",
        "transport_verified": True,
        "enabled": True,
    })
    return registry, devices


def test_enrolled_vacuum_reads_status_and_map_without_commands():
    registry, devices = make_registry()
    assert registry.read("living-room-vacuum", "status")["state"] == "docked"
    assert registry.read("living-room-vacuum", "map")["map_id"] == "living-room"
    assert all(call[0] == "GET" for call in devices["vacuum"].calls)


def test_vacuum_commands_require_explicit_approval():
    registry, devices = make_registry()
    assert registry.command("living-room-vacuum", "start")["status"] == "denied"
    assert registry.command("living-room-vacuum", "start", approved=True) == {"accepted": "start"}
    assert devices["vacuum"].calls[-1] == ("POST", "/api/v1/commands", {"command": "start"})


def test_unverified_transport_and_invalid_commands_fail_closed():
    registry = NetworkDeviceRegistry(Policy(["hardware_read", "device_control"]))
    registry.register_adapter("test-vacuum", lambda endpoint: VacuumAdapter(lambda *_: {}))
    with pytest.raises(ValueError):
        registry.enroll({
            "id": "bad vacuum",
            "type": "vacuum",
            "endpoint": "http://192.168.1.50",
            "adapter": "test-vacuum",
            "transport_verified": True,
            "enabled": True,
        })
    registry.enroll({
        "id": "unverified",
        "type": "vacuum",
        "endpoint": "http://192.168.1.51",
        "adapter": "test-vacuum",
        "transport_verified": False,
        "enabled": True,
    })
    with pytest.raises(PermissionError, match="transport"):
        registry.read("unverified", "status")
    with pytest.raises(ValueError, match="unsupported"):
        VacuumAdapter(lambda *_: {}).command("clean")


def test_map_snapshot_is_normalized_and_atomically_replaced(tmp_path):
    registry, _ = make_registry()
    store = MapSnapshotStore(tmp_path)
    snapshot = registry.capture_map(
        "living-room-vacuum",
        store,
        "2026-09-20T04:00:00+00:00",
    )
    assert snapshot == {
        "device_id": "living-room-vacuum",
        "map_id": "living-room",
        "revision": 1,
        "captured_at": "2026-09-20T04:00:00+00:00",
        "rooms": [],
        "obstacles": [],
    }
    assert store.latest("living-room-vacuum") == snapshot
    assert not list(tmp_path.glob("*.tmp"))


@pytest.mark.parametrize(
    "payload, message",
    [
        ({"map_id": "home", "revision": -1}, "revision"),
        ({"map_id": "home", "revision": 1, "rooms": ["kitchen"]}, "rooms"),
        ({"map_id": "home", "revision": 1, "obstacles": [None]}, "obstacles"),
    ],
)
def test_map_snapshot_rejects_invalid_metadata(tmp_path, payload, message):
    with pytest.raises(ValueError, match=message):
        MapSnapshotStore.normalize("living-room-vacuum", payload, "2026-09-20T04:00:00+00:00")


def test_map_snapshot_requires_timezone_and_preserves_room_metadata(tmp_path):
    store = MapSnapshotStore(tmp_path)
    payload = {
        "map_id": "home",
        "revision": 2,
        "rooms": [{"id": "kitchen", "name": "Kitchen"}],
        "obstacles": [{"id": "chair-1", "kind": "furniture"}],
    }
    snapshot = store.save("living-room-vacuum", payload, "2026-09-20T04:00:00Z")
    assert snapshot["rooms"][0]["name"] == "Kitchen"
    assert snapshot["obstacles"][0]["kind"] == "furniture"
    with pytest.raises(ValueError, match="timezone"):
        store.save("living-room-vacuum", payload, "2026-09-20T04:00:00")


def test_tank_exposes_read_only_map_snapshot_capture(tmp_path):
    registry, _ = make_registry()
    tank = TankWorker(
        Policy(["hardware_read"]),
        tmp_path / "audit.jsonl",
        network_devices=registry,
        map_snapshot_root=tmp_path / "maps",
    )
    result = tank.run({
        "operation": "network_device_map_snapshot",
        "device_id": "living-room-vacuum",
        "captured_at": "2026-09-20T04:00:00+00:00",
    })
    assert result["status"] == "completed"
    assert result["snapshot"]["revision"] == 1
    assert (tmp_path / "maps" / "living-room-vacuum.json").is_file()


def test_home_assistant_coredy_bridge_normalizes_read_only_state_and_map():
    calls = []

    def transport(method, path, body):
        calls.append((method, path, body))
        if method == "GET" and path.startswith("/api/states/"):
            return {
                "state": "docked",
                "attributes": {
                    "battery_level": 91,
                    "map_data": {"map_id": "home", "revision": 3, "rooms": []},
                },
            }
        return {"called": True}

    adapter = HomeAssistantVacuumAdapter(transport, "vacuum.coredy")
    assert adapter.status() == {"state": "docked", "battery_level": 91}
    assert adapter.map()["revision"] == 3
    assert calls[:2] == [
        ("GET", "/api/states/vacuum.coredy", None),
        ("GET", "/api/states/vacuum.coredy", None),
    ]


def test_home_assistant_coredy_bridge_commands_are_typed():
    calls = []
    adapter = HomeAssistantVacuumAdapter(
        lambda method, path, body: calls.append((method, path, body)) or {},
        "vacuum.coredy",
    )
    assert adapter.command("dock") == {}
    assert calls == [("POST", "/api/services/vacuum/return_to_base", {"entity_id": "vacuum.coredy"})]
