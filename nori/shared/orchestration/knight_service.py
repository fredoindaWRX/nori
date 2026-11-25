"""Loopback-only NORI Round Table service host.

This is the process boundary that turns the typed Knight runtime into an
operable local service.  It deliberately hosts the edition's Knights in one
process: roles share a NORI model runtime and audit stream, rather than each
starting an unrelated model copy.  Every call still goes through the named
Knight's typed contract in :mod:`knight_runtime`.
"""

from __future__ import annotations

import argparse
import hmac
import json
import os
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import sys
from typing import Any
from urllib.parse import urlsplit

# The staged runtime keeps the platform security package beside shared.
_NORI_ROOT = Path(__file__).resolve().parents[2]
if str(_NORI_ROOT) not in sys.path:
    sys.path.insert(0, str(_NORI_ROOT))

from orchestration.knight_runtime import KnightRuntime
from orchestration.wsl_python_runner import CONFIG as WSL_RUNNER_CONFIG, WslPythonRunner
from permissions.nori_policy import Policy
from security.hard_floor import load_hard_floor


MAX_REQUEST_BYTES = 1_048_576


def _loopback_url(value: str) -> str:
    parsed = urlsplit(value)
    if (parsed.scheme != "http" or parsed.hostname not in {"127.0.0.1", "::1"}
            or parsed.username or parsed.password or parsed.path not in {"", "/"}
            or parsed.query or parsed.fragment):
        raise ValueError("model endpoint must be a literal loopback HTTP URL")
    return value.rstrip("/")


class RoundTableService:
    """NORI-owned host for one active Home, Server, or Robotics Council."""

    def __init__(self, *, edition: str, model_endpoint: str, model: str,
                 grants: tuple[str, ...] | list[str], data_root: Path):
        load_hard_floor()
        self.edition = edition
        self.model_endpoint = _loopback_url(model_endpoint)
        self.model = model
        self.data_root = Path(data_root)
        self.data_root.mkdir(parents=True, exist_ok=True)
        python_runner = WslPythonRunner.configured() if WSL_RUNNER_CONFIG.is_file() else None
        self.runtime = KnightRuntime(
            self.model_endpoint,
            model,
            Policy(grants),
            self.data_root / "audit.jsonl",
            memory_root=self.data_root / "memory",
            knowledge_root=self.data_root / "knowledge",
            plugin_root=self.data_root / "plugins",
            workspace_root=self.data_root / "workspace",
            project_root=self.data_root / "workspace",
            learning_root=self.data_root / "learning",
            python_runner=python_runner,
        )
        self.active = self.runtime.configure_edition(edition)

    def health(self) -> dict[str, Any]:
        workers = self.runtime.registry.readiness()
        active = set(self.active)
        return {
            "schema": "nori.round-table-health.v1",
            "status": "ready",
            "edition": self.edition,
            "model_endpoint": self.model_endpoint,
            "model": self.model,
            "active_knights": list(self.active),
            "active_count": len(self.active),
            "roster_count": len(workers),
            "workers": [
                {**worker, "active": worker["id"] in active,
                 "service": "round-table" if worker["id"] in active else None}
                for worker in workers
            ],
        }

    def dispatch(self, request: object) -> dict[str, Any]:
        if not isinstance(request, dict):
            raise ValueError("dispatch request must be an object")
        return self.runtime.dispatch(request)


def create_handler(service: RoundTableService):
    # The host supplies this credential, never the dispatch payload. Capture it
    # when creating the listener so requests cannot change its authority.
    configured_token = os.environ.get("NORI_API_TOKEN", "")
    expected_credential = ("Bearer " + configured_token).encode("utf-8") if len(configured_token) >= 32 else None

    class Handler(BaseHTTPRequestHandler):
        server_version = "NORI-Round-Table/1"

        def log_message(self, _format: str, *_args: object) -> None:
            # Audit is recorded by the typed runtime.  Never put task content
            # into the general HTTP log.
            return

        def _write(self, status: HTTPStatus, payload: dict[str, Any]) -> None:
            encoded = json.dumps(payload, ensure_ascii=False).encode("utf-8")
            self.send_response(status)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(encoded)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(encoded)

        def do_GET(self) -> None:  # noqa: N802
            if self.path in {"/health", "/v1/knights"}:
                self._write(HTTPStatus.OK, service.health())
                return
            self._write(HTTPStatus.NOT_FOUND, {"error": "not_found"})

        def do_POST(self) -> None:  # noqa: N802
            if self.path != "/v1/dispatch":
                self._write(HTTPStatus.NOT_FOUND, {"error": "not_found"})
                return
            if expected_credential is None:
                self._write(HTTPStatus.SERVICE_UNAVAILABLE, {"error": "dispatch_authentication_unconfigured"})
                return
            credentials = self.headers.get_all("Authorization", [])
            if len(credentials) != 1 or not hmac.compare_digest(credentials[0].encode("utf-8"), expected_credential):
                self._write(HTTPStatus.UNAUTHORIZED, {"error": "unauthorized"})
                return
            raw_length = self.headers.get("Content-Length")
            try:
                length = int(raw_length or "")
                if length < 1 or length > MAX_REQUEST_BYTES:
                    raise ValueError
            except ValueError:
                self._write(HTTPStatus.BAD_REQUEST, {"error": "invalid_content_length"})
                return
            try:
                payload = json.loads(self.rfile.read(length).decode("utf-8"))
                result = service.dispatch(payload)
            except (UnicodeDecodeError, json.JSONDecodeError, ValueError) as error:
                self._write(HTTPStatus.BAD_REQUEST, {"error": "invalid_request", "reason": str(error)})
                return
            except PermissionError:
                self._write(HTTPStatus.FORBIDDEN, {"error": "policy_denied"})
                return
            except Exception as error:  # typed runtime records the failure
                self._write(HTTPStatus.INTERNAL_SERVER_ERROR,
                            {"error": "dispatch_failed", "reason": type(error).__name__})
                return
            self._write(HTTPStatus.OK, result)

    return Handler


def create_server(host: str, port: int, service: RoundTableService) -> ThreadingHTTPServer:
    if host not in {"127.0.0.1", "::1"}:
        raise ValueError("Round Table service may bind only to loopback")
    # Port zero asks the operating system for an unused loopback port.  It is
    # useful for isolated verification; the CLI still defaults to 9401.
    if not isinstance(port, int) or not 0 <= port <= 65535:
        raise ValueError("invalid port")
    return ThreadingHTTPServer((host, port), create_handler(service))


def main() -> int:
    parser = argparse.ArgumentParser(description="Run NORI's local Round Table service")
    parser.add_argument("--edition", choices=("home", "server", "robotics"), required=True)
    parser.add_argument("--model-endpoint", required=True)
    parser.add_argument("--model", required=True)
    parser.add_argument("--data-root", type=Path, required=True)
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=9401)
    parser.add_argument("--grant", action="append", default=[])
    args = parser.parse_args()
    token_file = os.environ.get("NORI_API_TOKEN_FILE")
    if token_file:
        from identity.round_table_provision import load_service_token
        os.environ["NORI_API_TOKEN"] = load_service_token(Path(token_file))
    service = RoundTableService(
        edition=args.edition, model_endpoint=args.model_endpoint, model=args.model,
        grants=args.grant, data_root=args.data_root,
    )
    server = create_server(args.host, args.port, service)
    try:
        server.serve_forever()
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
