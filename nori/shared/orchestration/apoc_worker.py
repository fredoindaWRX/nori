"""NORI-native bounded public-web Scout for the Apoc Knight.

Apoc is deliberately read-only in this foundation: no form submission, login,
download, browser scripting, or local/private-network access is permitted.
Remote requests additionally require the host's hard-floor transport approval;
until a verified remote transport is provisioned, public-web reads fail closed.
"""

from __future__ import annotations

from html.parser import HTMLParser
import ipaddress
import socket
from pathlib import Path
import sys
from typing import Any
from urllib.parse import urlsplit
from urllib.request import Request
from uuid import uuid4

# Shared runtime entry points also run with only nori/shared on sys.path.
_NORI_ROOT = Path(__file__).resolve().parents[2]
if str(_NORI_ROOT) not in sys.path:
    sys.path.insert(0, str(_NORI_ROOT))

from audit.nori_audit import record
from permissions.nori_policy import Policy
from security.hard_floor import assert_network_allowed, open_url


class _Text(HTMLParser):
    def __init__(self):
        super().__init__(); self.parts: list[str] = []; self.skip = 0
    def handle_starttag(self, tag, attrs):
        if tag in {"script", "style", "noscript"}: self.skip += 1
    def handle_endtag(self, tag):
        if tag in {"script", "style", "noscript"} and self.skip: self.skip -= 1
    def handle_data(self, data):
        if not self.skip and data.strip(): self.parts.append(data.strip())


class ApocWorker:
    def __init__(self, policy: Policy, audit_path: Path):
        self.policy = policy; self.audit_path = Path(audit_path)

    @staticmethod
    def _public_url(value: object) -> str:
        if not isinstance(value, str) or len(value) > 2048:
            raise ValueError("url is invalid")
        parts = urlsplit(value)
        if parts.scheme not in {"http", "https"} or not parts.hostname or parts.username or parts.password or parts.fragment:
            raise ValueError("url is invalid")
        try:
            addresses = {item[4][0] for item in socket.getaddrinfo(parts.hostname, parts.port or (443 if parts.scheme == "https" else 80), type=socket.SOCK_STREAM)}
            if not addresses or any(not ipaddress.ip_address(address).is_global for address in addresses):
                raise ValueError("url must resolve only to public addresses")
        except socket.gaierror as error:
            raise ValueError("url host is unavailable") from error
        return value

    def run(self, request: dict[str, Any]) -> dict:
        if not isinstance(request, dict) or set(request) != {"operation", "url"} or request.get("operation") != "inspect":
            raise ValueError("apoc request is invalid")
        task_id = str(uuid4()); decision = self.policy.decide("browser_read")
        if not decision.allowed:
            record(self.audit_path, "apoc_browser", task_id, "denied", {"reason": decision.reason})
            return {"status": "denied", "task_id": task_id, "reason": decision.reason}
        try:
            # Reject unapproved remote targets before DNS or any connection.
            # Payload fields cannot assert that a transport has been verified.
            assert_network_allowed(request["url"])
            url = self._public_url(request["url"])
            response = open_url(Request(url, headers={"User-Agent": "NORI-Apoc/0.1"}), timeout=15)
            with response:
                content_type = response.headers.get_content_type(); raw = response.read(1_000_001)
                if len(raw) > 1_000_000: raise ValueError("page exceeds size limit")
                if content_type not in {"text/html", "text/plain"}: raise ValueError("page content type is unsupported")
                text = raw.decode(response.headers.get_content_charset() or "utf-8", errors="replace")
            if content_type == "text/html":
                parser = _Text(); parser.feed(text); text = " ".join(parser.parts)
            result = {"url": url, "content_type": content_type, "text": text[:30_000]}
            record(self.audit_path, "apoc_browser", task_id, "completed", {"host": urlsplit(url).hostname, "bytes": len(raw)})
            return {"status": "completed", "task_id": task_id, "result": result}
        except PermissionError as error:
            record(self.audit_path, "apoc_browser", task_id, "denied", {"error_type": type(error).__name__})
            raise
        except Exception as error:
            record(self.audit_path, "apoc_browser", task_id, "failed", {"error_type": type(error).__name__})
            raise
