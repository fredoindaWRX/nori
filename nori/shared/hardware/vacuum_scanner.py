"""Multi-protocol vacuum scanner and adapter factory for NORI.

Provides discovery, probe sequence, and adapter negotiation across:
1. Home Assistant REST entity (`vacuum.<name>`, e.g. `vacuum.coredy`)
2. Local REST / Valetudo bridge (`/api/v1/status`, `/api/valetudo/version`)
3. UDP / local network probes (Tuya / local protocols)
"""

from __future__ import annotations

import json
import socket
from typing import Any, Callable, Dict, Optional
from urllib.parse import urlsplit
from urllib.request import Request, build_opener, ProxyHandler

from hardware.network_devices import VacuumAdapter, HomeAssistantVacuumAdapter


class VacuumScanner:
    """Probes candidate vacuum endpoints across available protocols in priority order."""

    def __init__(self, ha_adapter=None, timeout_sec: float = 2.0):
        self.ha_adapter = ha_adapter
        self.timeout_sec = timeout_sec

    def probe_home_assistant(self, entity_id: str) -> Optional[Dict[str, Any]]:
        """Probe Home Assistant for the specified vacuum entity."""
        if not self.ha_adapter:
            return None
        ha_status = self.ha_adapter.status()
        if not ha_status.get("configured") or not ha_status.get("trusted"):
            return None
        try:
            state = self.ha_adapter.get_state(entity_id)
            if state.get("success") and isinstance(state.get("result"), dict):
                return {
                    "protocol": "home_assistant",
                    "entity_id": entity_id,
                    "state": state["result"].get("state"),
                    "attributes": state["result"].get("attributes", {}),
                    "verified": True,
                }
        except Exception:
            pass
        return None

    def probe_rest_endpoint(self, base_url: str) -> Optional[Dict[str, Any]]:
        """Probe local REST / Valetudo endpoint."""
        url = base_url.rstrip("/")
        endpoints = [
            ("/api/v1/status", "rest_v1"),
            ("/api/valetudo/version", "valetudo"),
        ]
        opener = build_opener(ProxyHandler({}))
        for path, proto in endpoints:
            try:
                req = Request(url + path, method="GET")
                with opener.open(req, timeout=self.timeout_sec) as resp:
                    if resp.status == 200:
                        raw = resp.read()
                        data = json.loads(raw.decode("utf-8")) if raw else {}
                        return {
                            "protocol": proto,
                            "endpoint": url,
                            "probe_path": path,
                            "data": data,
                            "verified": True,
                        }
            except Exception:
                continue
        return None

    def probe_udp_broadcast(self, host: str, port: int = 6667) -> Optional[Dict[str, Any]]:
        """Probe UDP port for presence / banner."""
        try:
            s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
            s.settimeout(self.timeout_sec)
            s.sendto(b"ping", (host, port))
            data, _ = s.recvfrom(2048)
            s.close()
            return {
                "protocol": "udp_tuya",
                "host": host,
                "port": port,
                "data": data.hex(),
                "verified": True,
            }
        except Exception:
            pass
        return None

    def discover_and_bind(
        self,
        identifier: str,
        transport_override: Optional[Callable] = None,
    ) -> Dict[str, Any]:
        """Attempt discovery across protocols in order: HA -> Local REST -> UDP."""
        # Tier 1: Home Assistant entity (e.g. vacuum.coredy)
        if identifier.startswith("vacuum."):
            ha_info = self.probe_home_assistant(identifier)
            if ha_info:
                def ha_transport(method: str, path: str, body: Any = None):
                    if method == "GET":
                        st = self.ha_adapter.get_state(identifier)
                        return st.get("result", {})
                    elif method == "POST":
                        service = path.split("/")[-1]
                        return self.ha_adapter._request(
                            "POST",
                            f"/api/services/vacuum/{service}",
                            body or {"entity_id": identifier},
                        )
                    raise ValueError(f"Unsupported method {method}")

                adapter = HomeAssistantVacuumAdapter(transport_override or ha_transport, identifier)
                return {
                    "status": "bound",
                    "protocol": "home_assistant",
                    "target": identifier,
                    "adapter": adapter,
                    "details": ha_info,
                }

        # Tier 2: HTTP / REST endpoint (e.g. http://10.0.0.193:8080)
        parsed = urlsplit(identifier)
        if parsed.scheme in {"http", "https"}:
            rest_info = self.probe_rest_endpoint(identifier)
            if rest_info:
                base = identifier.rstrip("/")
                opener = build_opener(ProxyHandler({}))

                def rest_transport(method: str, path: str, body: Any = None):
                    data = None if body is None else json.dumps(body).encode("utf-8")
                    req = Request(
                        base + path,
                        data=data,
                        method=method,
                        headers={"Content-Type": "application/json"},
                    )
                    with opener.open(req, timeout=5) as r:
                        raw = r.read()
                        return json.loads(raw.decode("utf-8")) if raw else {}

                adapter = VacuumAdapter(transport_override or rest_transport)
                return {
                    "status": "bound",
                    "protocol": rest_info["protocol"],
                    "target": identifier,
                    "adapter": adapter,
                    "details": rest_info,
                }

        return {
            "status": "unreachable",
            "target": identifier,
            "error": "no_candidate_protocol_succeeded",
        }

