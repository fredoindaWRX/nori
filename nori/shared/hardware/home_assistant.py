"""Typed Home Assistant boundary used by Tank.

Credentials stay in the owner-enrolled JSON file.  Results never include the
token, and state-changing calls are successful only after readback matches.
"""
from __future__ import annotations

import json
import os
from urllib.parse import urlsplit
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import Request, build_opener, ProxyHandler


DEFAULT_CONFIG = Path(os.getenv(
    "NORI_HOME_ASSISTANT_CONFIG", r"C:\Nori\integrations\home_assistant.json"
))


class HomeAssistant:
    def __init__(self, config_path=DEFAULT_CONFIG, transport=None):
        self.config_path = Path(config_path)
        self.transport = transport or self._http

    def _config(self):
        try:
            value = json.loads(self.config_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            return None
        if not isinstance(value, dict):
            return None
        return value

    def status(self):
        config = self._config()
        if not config:
            return {"configured": False, "trusted": False}
        return {
            "configured": bool(config.get("base_url") and config.get("token")),
            "trusted": config.get("trusted") is True,
            "integration_id": str(config.get("integration_id", "home_base")),
            "base_url": str(config.get("base_url", "")),
        }

    def configure(self, base_url, token, *, integration_id="home_base"):
        """Test and atomically save an owner-supplied Home Assistant connection."""
        base_url = str(base_url or "").strip().rstrip("/")
        token = str(token or "").strip()
        parsed = urlsplit(base_url)
        if parsed.scheme not in {"http", "https"} or not parsed.netloc or parsed.query or parsed.fragment:
            return {"success": False, "error": "base_url_invalid"}
        if not token or len(token) > 4096:
            return {"success": False, "error": "token_required"}
        try:
            self.transport("GET", base_url + "/api/", token, None)
        except (HTTPError, URLError, OSError, ValueError, TimeoutError) as exc:
            return {"success": False, "error": "connection_failed", "detail": type(exc).__name__}
        config = {"base_url": base_url, "token": token, "trusted": True,
                  "integration_id": str(integration_id or "home_base")[:80]}
        try:
            self.config_path.parent.mkdir(parents=True, exist_ok=True)
            temporary = self.config_path.with_suffix(self.config_path.suffix + ".tmp")
            temporary.write_text(json.dumps(config, indent=2) + "\n", encoding="utf-8")
            os.replace(temporary, self.config_path)
        except OSError:
            try:
                temporary.unlink(missing_ok=True)
            except OSError:
                pass
            return {"success": False, "error": "config_write_failed"}
        return {"success": True, "status": self.status()}

    def _request(self, method, path, body=None):
        config = self._config()
        if not config or config.get("trusted") is not True:
            return {"success": False, "error": "home_assistant_not_trusted"}
        base_url = str(config.get("base_url", "")).rstrip("/")
        token = str(config.get("token", ""))
        if not base_url or not token:
            return {"success": False, "error": "home_assistant_not_configured"}
        try:
            result = self.transport(method, base_url + path, token, body)
            return {"success": True, "result": result}
        except (HTTPError, URLError, OSError, ValueError, TimeoutError) as exc:
            return {"success": False, "error": type(exc).__name__}

    @staticmethod
    def _http(method, url, token, body):
        data = None if body is None else json.dumps(body).encode("utf-8")
        request = Request(url, data=data, method=method, headers={
            "Authorization": "Bearer " + token,
            "Content-Type": "application/json",
        })
        with build_opener(ProxyHandler({})).open(request, timeout=10) as response:
            raw = response.read()
        return json.loads(raw) if raw else None

    def get_state(self, entity_id):
        entity_id = str(entity_id or "").strip().casefold()
        if not entity_id or "." not in entity_id or len(entity_id) > 160:
            raise ValueError("entity_id is invalid")
        return self._request("GET", "/api/states/" + entity_id)

    def list_entities(self):
        """Return a bounded, read-only summary of entities visible to the owner."""
        response = self._request("GET", "/api/states")
        if not response.get("success") or not isinstance(response.get("result"), list):
            return {"success": False, "error": "entity_discovery_failed"}
        entities = []
        for item in response["result"][:2000]:
            if not isinstance(item, dict) or not isinstance(item.get("entity_id"), str):
                continue
            attributes = item.get("attributes") if isinstance(item.get("attributes"), dict) else {}
            entities.append({
                "entity_id": item["entity_id"][:160],
                "state": str(item.get("state", ""))[:80],
                "friendly_name": str(attributes.get("friendly_name", ""))[:160],
                "domain": item["entity_id"].split(".", 1)[0][:40],
            })
        return {"success": True, "entities": entities, "count": len(entities)}

    def set_light(self, entity_id, *, on, brightness_percent=None, rgb_color=None):
        entity_id = str(entity_id or "").strip().casefold()
        if not entity_id.startswith("light.") or len(entity_id) <= 6:
            raise ValueError("entity_id must identify a light.* entity")
        brightness = None if brightness_percent is None else int(brightness_percent)
        if brightness is not None and not 0 <= brightness <= 100:
            raise ValueError("brightness_percent must be between 0 and 100")
        rgb = None
        if rgb_color is not None:
            if not isinstance(rgb_color, (list, tuple)) or len(rgb_color) != 3:
                raise ValueError("rgb_color must contain three channels")
            rgb = [int(channel) for channel in rgb_color]
            if any(channel < 0 or channel > 255 for channel in rgb):
                raise ValueError("rgb_color channels must be between 0 and 255")

        before = self.get_state(entity_id)
        if not before.get("success") or not isinstance(before.get("result"), dict):
            return {"success": False, "verified": False, "error": "read_before_failed"}
        service = "turn_on" if on else "turn_off"
        data = {"entity_id": entity_id}
        if on and brightness is not None:
            data["brightness_pct"] = brightness
        if on and rgb is not None:
            data["rgb_color"] = rgb
        action = self._request("POST", f"/api/services/light/{service}", data)
        if not action.get("success"):
            return {"success": False, "verified": False, "error": "service_call_failed"}
        after = self.get_state(entity_id)
        value = after.get("result") if after.get("success") else None
        if not isinstance(value, dict):
            return {"success": False, "verified": False, "error": "readback_failed"}
        mismatches = []
        if str(value.get("state", "")).casefold() != ("on" if on else "off"):
            mismatches.append("power")
        attributes = value.get("attributes") if isinstance(value.get("attributes"), dict) else {}
        if on and brightness is not None:
            actual = attributes.get("brightness")
            expected = round(brightness * 255 / 100)
            if actual is None or abs(int(actual) - expected) > 3:
                mismatches.append("brightness")
        if on and rgb is not None and list(attributes.get("rgb_color") or []) != rgb:
            mismatches.append("color")
        return {
            "success": not mismatches,
            "verified": not mismatches,
            "entity_id": entity_id,
            "mismatches": mismatches,
            "before": before["result"],
            "after": value,
        }

    def set_switch(self, entity_id, *, on):
        """Set one switch/outlet and verify the resulting state."""
        entity_id = str(entity_id or "").strip().casefold()
        if not entity_id.startswith("switch.") or len(entity_id) <= 7:
            raise ValueError("entity_id must identify a switch.* entity")
        before = self.get_state(entity_id)
        if not before.get("success") or not isinstance(before.get("result"), dict):
            return {"success": False, "verified": False, "error": "read_before_failed"}
        service = "turn_on" if on else "turn_off"
        action = self._request("POST", f"/api/services/switch/{service}", {"entity_id": entity_id})
        if not action.get("success"):
            return {"success": False, "verified": False, "error": "service_call_failed"}
        after = self.get_state(entity_id)
        value = after.get("result") if after.get("success") else None
        if not isinstance(value, dict):
            return {"success": False, "verified": False, "error": "readback_failed"}
        expected = "on" if on else "off"
        matches = str(value.get("state", "")).casefold() == expected
        return {
            "success": matches,
            "verified": matches,
            "entity_id": entity_id,
            "mismatches": [] if matches else ["power"],
            "before": before["result"],
            "after": value,
        }

    def vacuum_command(self, entity_id, *, command):
        """Run one allowlisted vacuum command and verify the resulting state."""
        entity_id = str(entity_id or "").strip().casefold()
        command = str(command or "").strip().casefold()
        allowed = {
            "start": ("start", {"cleaning", "on"}),
            "stop": ("stop", {"idle", "docked", "off"}),
            "pause": ("pause", {"paused"}),
            "return_to_base": ("return_to_base", {"returning", "docked"}),
        }
        if not entity_id.startswith("vacuum.") or len(entity_id) <= 7:
            raise ValueError("entity_id must identify a vacuum.* entity")
        if command not in allowed:
            raise ValueError("vacuum command is not supported")
        before = self.get_state(entity_id)
        if not before.get("success") or not isinstance(before.get("result"), dict):
            return {"success": False, "verified": False, "error": "read_before_failed"}
        service, expected_states = allowed[command]
        action = self._request("POST", f"/api/services/vacuum/{service}", {"entity_id": entity_id})
        if not action.get("success"):
            return {"success": False, "verified": False, "error": "service_call_failed"}
        after = self.get_state(entity_id)
        value = after.get("result") if after.get("success") else None
        if not isinstance(value, dict):
            return {"success": False, "verified": False, "error": "readback_failed"}
        actual = str(value.get("state", "")).casefold()
        matches = actual in expected_states
        return {
            "success": matches,
            "verified": matches,
            "entity_id": entity_id,
            "command": command,
            "mismatches": [] if matches else ["state"],
            "before": before["result"],
            "after": value,
        }
