"""Non-installing diagnostics for the N.O.R.I. desktop runtime."""
from __future__ import annotations

import ast
import sys
from pathlib import Path

if __package__ in (None, ""):
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from nori.deps import DependencyManager
from nori.roadmap_status import report as roadmap_report
import json
import time
import urllib.request


WORKSPACE_STATUS_URL = "http://127.0.0.1:9444/api/status"
COUNCIL_HEALTH_URL = "http://127.0.0.1:9107/health"
ROOT = Path(__file__).resolve().parents[1]


def _source_constant(path: Path, name: str) -> str | None:
    """Read a service revision without importing code that builds its runtime."""
    try:
        tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
        for statement in ast.walk(tree):
            if isinstance(statement, ast.Assign):
                targets = statement.targets
                value = statement.value
            elif isinstance(statement, ast.AnnAssign):
                targets = [statement.target]
                value = statement.value
            else:
                continue
            if (any(isinstance(target, ast.Name) and target.id == name for target in targets)
                    and isinstance(value, ast.Constant) and isinstance(value.value, str)):
                return value.value
    except (OSError, SyntaxError, UnicodeError):
        pass
    return None


def _request_json(url: str) -> tuple[int, dict[str, object]]:
    with urllib.request.urlopen(url, timeout=1.5) as response:
        payload = json.loads(response.read().decode("utf-8"))
    if not isinstance(payload, dict):
        raise ValueError("expected JSON object")
    return response.status, payload


def _workspace_status() -> dict[str, object]:
    expected = _source_constant(ROOT / "workspace" / "server.py", "BRIDGE_REVISION")
    result: dict[str, object] = {"endpoint": WORKSPACE_STATUS_URL, "reachable": False,
                                 "expected_bridge_revision": expected}
    try:
        status, payload = _request_json(WORKSPACE_STATUS_URL)
        revision = payload.get("bridge_revision")
        result.update({"reachable": True, "http_status": status, "connected": payload.get("connected") is True,
                       "bridge_revision": revision,
                       "revision_current": isinstance(revision, str) and revision == expected})
    except Exception as exc:
        result["error"] = f"{type(exc).__name__}: {exc}"
    return result


def _council_status() -> dict[str, object]:
    expected = _source_constant(ROOT / "nori" / "work_sessions.py", "RUNTIME_REVISION")
    result: dict[str, object] = {"endpoint": COUNCIL_HEALTH_URL, "reachable": False,
                                 "expected_work_runtime_revision": expected}
    try:
        status, payload = _request_json(COUNCIL_HEALTH_URL)
        runtime = payload.get("work_runtime")
        revision = runtime.get("revision") if isinstance(runtime, dict) else None
        result.update({"reachable": True, "http_status": status, "status": payload.get("status"),
                       "model_ready": payload.get("model_ready") is True,
                       "work_available": payload.get("work_available") is True,
                       "work_runtime_revision": revision,
                       "revision_current": isinstance(revision, str) and revision == expected})
    except Exception as exc:
        result["error"] = f"{type(exc).__name__}: {exc}"
    return result


def collect() -> dict[str, object]:
    result: dict[str, object] = {"schema": "nori.diagnostics.v1", "checked_at": time.time()}
    try:
        result["dependencies"] = DependencyManager(Path(__file__).parent / "deps" / "allowlist.yaml").check()
    except Exception as exc:
        result["dependencies"] = {"result": "FAIL", "error": str(exc)}
    try:
        from system_agent import snapshot
        health = snapshot()
        result["health"] = {"status": health.get("health", {}).get("status"), "warnings": health.get("health", {}).get("warnings", [])}
    except Exception as exc:
        result["health"] = {"status": "DEGRADED", "error": str(exc)}
    result["roadmap"] = roadmap_report(run_checks=False)
    try:
        with urllib.request.urlopen("http://127.0.0.1:9390/health", timeout=1.5) as response:
            payload = json.loads(response.read().decode("utf-8"))
        result["event_bus"] = {"reachable": True, "status": response.status, "service": payload.get("service"), "schema": payload.get("schema")}
    except Exception as exc:
        result["event_bus"] = {"reachable": False, "error": str(exc)}
    # The live owner-facing surfaces are authoritative for current readiness.
    # Older process/source audits remain available as legacy evidence below.
    result["workspace"] = _workspace_status()
    result["council"] = _council_status()
    try:
        from aoki_team.status import build_status
        result["local_team"] = build_status()
    except Exception as exc:
        result["local_team"] = {"error": str(exc)}
    try:
        from nori.native_source_status import inspect_source
        result["native_source"] = inspect_source()
    except Exception as exc:
        result["native_source"] = {"error": str(exc)}
    try:
        from startup_authority_verifier import verify_startup_authority
        result["startup_authority"] = verify_startup_authority()
    except Exception as exc:
        result["startup_authority"] = {"error": str(exc)}
    try:
        from notification_router import transport_status
        result["notifications"] = transport_status()
    except Exception as exc:
        result["notifications"] = {"configured": False, "mode": "error", "error": str(exc)}
    try:
        import psutil
        relevant = []
        for process in psutil.process_iter(["name", "exe"]):
            name = (process.info.get("name") or "").casefold()
            if name in {"aoki.desktop.exe", "nori.desktop.exe", "noridesktop.exe", "noridesktop-win64-shipping.exe", "cortana.exe"}:
                relevant.append({"name": process.info.get("name"), "exe": process.info.get("exe")})
        result["desktop_processes"] = relevant
    except Exception as exc:
        result["desktop_processes"] = {"error": str(exc)}
    return result


def write_report(path: Path | None = None) -> Path:
    target = Path(path or r"C:\Nori\health\latest_nori_diagnostics.json")
    target.parent.mkdir(parents=True, exist_ok=True)
    temporary = target.with_suffix(target.suffix + ".tmp")
    temporary.write_text(json.dumps(collect(), indent=2, ensure_ascii=False), encoding="utf-8")
    temporary.replace(target)
    return target


if __name__ == "__main__":
    print(json.dumps(collect(), indent=2, ensure_ascii=False))
