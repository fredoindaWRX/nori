"""Controlled adapter test; never operates a real home device."""
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from orchestration.tank_worker import TankWorker
from permissions.nori_policy import Policy
from hardware.network_devices import HomeAssistantVacuumAdapter
import pytest

@pytest.mark.parametrize("command,state,success", [
    ("start", "cleaning", True),
    ("dock", "returning", True),
    ("dock", "docked", True),
    ("start", "cleaning", False),
])
def test_tank_real_adapter_contract_with_controlled_transport(tmp_path, command, state, success):
    calls = []
    def transport(method, path, body):
        calls.append((method, path, body))
        return {"success": success} if method == "POST" else {"state": state}
    adapter = HomeAssistantVacuumAdapter(transport, "vacuum.test")
    class Scanner:
        def discover_and_bind(self, identifier):
            return {"status": "bound", "adapter": adapter, "protocol": "home_assistant"}
    class Home:
        def status(self):
            return {"configured": False}
    tank = TankWorker(Policy(["home_control"]), tmp_path / "audit.jsonl",
                      home_assistant=Home(), vacuum_scanner=Scanner())
    result = tank.run({"operation": "home_vacuum_command", "entity_id": "vacuum.test", "command": command})
    assert result["home"]["verified"] is success
    assert result["status"] == ("completed" if success else "failed")
    service = "return_to_base" if command == "dock" else command
    assert calls[0][1] == "/api/services/vacuum/" + service

@pytest.mark.parametrize("command_result,state", [
    ({"ok": False}, "cleaning"),
    ({"accepted": "start"}, "docked"),
    ({"accepted": "start"}, ""),
    ({"accepted": "stop"}, "cleaning"),
    ({"ok": False, "accepted": "start"}, "cleaning"),
])
def test_tank_does_not_verify_failed_or_unconfirmed_start(tmp_path, command_result, state):
    class Adapter:
        def command(self, command):
            return command_result
        def status(self):
            return {"state": state}
    class Scanner:
        def discover_and_bind(self, identifier):
            return {"status": "bound", "adapter": Adapter(), "protocol": "test"}
    class Home:
        def status(self):
            return {"configured": False}
    tank = TankWorker(Policy(["home_control"]), tmp_path / "audit.jsonl",
                      home_assistant=Home(), vacuum_scanner=Scanner())
    result = tank.run({"operation": "home_vacuum_command", "entity_id": "vacuum.test", "command": "start"})
    assert result["status"] == "failed"
    assert result["home"]["verified"] is False

@pytest.mark.parametrize("readback", [None, [], "cleaning"])
def test_tank_malformed_readback_is_not_verified(tmp_path, readback):
    class Adapter:
        def command(self, command):
            return {"success": True}
        def status(self):
            return readback
    class Scanner:
        def discover_and_bind(self, identifier):
            return {"status": "bound", "adapter": Adapter()}
    class Home:
        def status(self):
            return {"configured": False}
    tank = TankWorker(Policy(["home_control"]), tmp_path / "audit.jsonl",
                      home_assistant=Home(), vacuum_scanner=Scanner())
    result = tank.run({"operation": "home_vacuum_command", "entity_id": "vacuum.test", "command": "start"})
    assert result["status"] == "failed"
    assert result["home"]["verified"] is False

def test_tank_denied_home_control_never_discovers_or_operates_device(tmp_path):
    class ForbiddenAdapter:
        def status(self):
            raise AssertionError("Home adapter must not be reached")
        def discover_and_bind(self, *args, **kwargs):
            raise AssertionError("Scanner must not be reached")
    forbidden = ForbiddenAdapter()
    tank = TankWorker(Policy([]), tmp_path / "audit.jsonl",
                      home_assistant=forbidden, vacuum_scanner=forbidden)
    result = tank.run({"operation": "home_vacuum_command", "entity_id": "vacuum.test", "command": "start"})
    assert result["status"] == "denied"

def test_tank_home_vacuum_fallback_to_vacuum_scanner(tmp_path):
    class FakeBoundAdapter:
        def __init__(self):
            self.called = []

        def command(self, cmd):
            self.called.append(cmd)
            return {"accepted": cmd}

        def status(self):
            return {"state": "cleaning"}

    class FakeScanner:
        def __init__(self, bound_adapter):
            self.bound_adapter = bound_adapter

        def discover_and_bind(self, identifier, transport_override=None):
            return {
                "status": "bound",
                "protocol": "test_protocol",
                "target": identifier,
                "adapter": self.bound_adapter,
            }

    bound_adapter = FakeBoundAdapter()
    scanner = FakeScanner(bound_adapter)

    class UnconfiguredHA:
        def status(self):
            return {"configured": False, "trusted": False}

    tank = TankWorker(
        Policy(["home_control"]),
        tmp_path / "audit.jsonl",
        home_assistant=UnconfiguredHA(),
        vacuum_scanner=scanner,
    )

    result = tank.run({
        "operation": "home_vacuum_command",
        "entity_id": "vacuum.coredy",
        "command": "start",
    })
    assert result["status"] == "completed"
    assert result["home"]["verified"] is True
    assert result["home"]["command"] == "start"
    assert result["home"]["protocol"] == "test_protocol"
    assert bound_adapter.called == ["start"]
