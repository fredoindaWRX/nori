"""Tests for VacuumScanner multi-protocol discovery and binding."""

import json
from unittest.mock import MagicMock
import pytest

from hardware.vacuum_scanner import VacuumScanner
from hardware.network_devices import HomeAssistantVacuumAdapter, VacuumAdapter


def test_probe_home_assistant_unconfigured():
    ha = MagicMock()
    ha.status.return_value = {"configured": False, "trusted": False}
    scanner = VacuumScanner(ha_adapter=ha)
    assert scanner.probe_home_assistant("vacuum.coredy") is None


def test_probe_home_assistant_success():
    ha = MagicMock()
    ha.status.return_value = {"configured": True, "trusted": True}
    ha.get_state.return_value = {
        "success": True,
        "result": {
            "entity_id": "vacuum.coredy",
            "state": "docked",
            "attributes": {"battery_level": 95},
        },
    }
    scanner = VacuumScanner(ha_adapter=ha)
    info = scanner.probe_home_assistant("vacuum.coredy")
    assert info is not None
    assert info["protocol"] == "home_assistant"
    assert info["state"] == "docked"
    assert info["attributes"]["battery_level"] == 95


def test_discover_and_bind_home_assistant():
    ha = MagicMock()
    ha.status.return_value = {"configured": True, "trusted": True}
    ha.get_state.return_value = {
        "success": True,
        "result": {
            "entity_id": "vacuum.coredy",
            "state": "docked",
            "attributes": {},
        },
    }
    scanner = VacuumScanner(ha_adapter=ha)
    res = scanner.discover_and_bind("vacuum.coredy")
    assert res["status"] == "bound"
    assert res["protocol"] == "home_assistant"
    assert isinstance(res["adapter"], HomeAssistantVacuumAdapter)


def test_probe_rest_endpoint_mock(monkeypatch):
    scanner = VacuumScanner(timeout_sec=0.5)

    class FakeResponse:
        def __init__(self, data):
            self.status = 200
            self._data = data

        def read(self):
            return self._data

        def __enter__(self):
            return self

        def __exit__(self, *args):
            pass

    def fake_open(req, timeout=None):
        if "/api/v1/status" in req.full_url:
            return FakeResponse(b'{"state":"cleaning","battery":80}')
        raise ValueError("Not found")

    mock_opener = MagicMock()
    mock_opener.open.side_effect = fake_open
    monkeypatch.setattr("hardware.vacuum_scanner.build_opener", lambda *args: mock_opener)

    info = scanner.probe_rest_endpoint("http://10.0.0.193:8080")
    assert info is not None
    assert info["protocol"] == "rest_v1"
    assert info["data"]["state"] == "cleaning"


def test_discover_and_bind_unreachable():
    scanner = VacuumScanner()
    res = scanner.discover_and_bind("vacuum.unknown")
    assert res["status"] == "unreachable"
    assert res["error"] == "no_candidate_protocol_succeeded"
