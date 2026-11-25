"""One-command current truth report for Nori and West Line."""
from __future__ import annotations

import json
import sys
import time
from pathlib import Path

if __package__ in (None, ""):
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from nori.diagnostics import collect as collect_diagnostics


REPORT_PATH = Path(r"C:\Nori\health\nori_current_truth.json")
TEXT_REPORT_PATH = Path(r"C:\Nori\health\current_truth_latest.txt")

# Fields that describe the real Workspace and Council readiness. Retired
# native/avatar desktop surfaces (process detection and native source identity)
# are kept out of this platform record; they remain available as non-deciding
# history under summary.legacy_evidence.
PLATFORM_EVIDENCE_KEYS = (
    "endpoint",
    "reachable",
    "http_status",
    "connected",
    "bridge_revision",
    "expected_bridge_revision",
    "revision_current",
    "status",
    "model_ready",
    "work_available",
    "work_runtime_revision",
    "expected_work_runtime_revision",
    "error",
)


def _platform_record(source: object) -> dict[str, object]:
    if not isinstance(source, dict):
        return {"reachable": False, "error": "missing_local_service_record"}
    return {key: source[key] for key in PLATFORM_EVIDENCE_KEYS if key in source}


def platform_evidence(diagnostics: dict[str, object]) -> dict[str, object]:
    """Live Workspace/Council readiness facts for the current platform.

    Only the surfaces the owner actually runs are reported here: the Workspace
    bridge and the Council. Retired avatar/native-desktop readiness checks are
    intentionally excluded instead of being presented as current truth.
    """
    return {
        "workspace": _platform_record(diagnostics.get("workspace")),
        "council": _platform_record(diagnostics.get("council")),
        "event_bus": diagnostics.get("event_bus"),
        "startup_authority": diagnostics.get("startup_authority"),
    }


def build() -> dict[str, object]:
    diagnostics = collect_diagnostics()
    westline = diagnostics.get("westline", {})
    local_team = diagnostics.get("local_team", {})
    roadmap = diagnostics.get("roadmap", {}).get("end_to_end_summary", {})
    startup = diagnostics.get("startup_authority", {})
    workspace = diagnostics.get("workspace", {})
    council = diagnostics.get("council", {})
    admin = westline.get("admin_surface", {}) if isinstance(westline, dict) else {}
    gameplay = westline.get("gameplay_hotfixes", {}) if isinstance(westline, dict) else {}

    checks = {
        "workspace_listener_reachable": workspace.get("reachable") is True,
        "workspace_connected_to_council": workspace.get("connected") is True,
        "council_listener_reachable": council.get("reachable") is True,
        "council_ready": council.get("status") == "ready" and council.get("model_ready") is True,
        "council_work_available": council.get("work_available") is True,
        "workspace_release_current": workspace.get("revision_current") is True,
        "council_release_current": council.get("revision_current") is True,
        "westline_game_healthy": isinstance(westline, dict) and westline.get("status") == "HEALTHY",
        "westline_gameplay_hotfixes": gameplay.get("success") is True,
        "westline_admin_ready": admin.get("status") == "READY",
    }
    # West Line is an explicitly separate side project. Keep its checks in the
    # report for visibility, but never let its state block N.O.R.I. readiness.
    operational_check_names = (
        "workspace_listener_reachable",
        "workspace_connected_to_council",
        "council_listener_reachable",
        "council_ready",
        "council_work_available",
    )
    release_check_names = (
        "workspace_release_current",
        "council_release_current",
    )
    blockers = [name for name in operational_check_names if not checks[name]]
    release_blockers = [name for name in release_check_names if not checks[name]]
    warnings = []
    if admin.get("status") == "GAME_ONLY":
        warnings.append("West Line is playable, but txAdmin/admin console is not listening.")

    update_pending = bool(release_blockers)
    if blockers:
        overall = "ATTENTION"
    elif update_pending:
        overall = "UPDATE_PENDING"
    elif warnings:
        overall = "READY_WITH_WARNINGS"
    else:
        overall = "READY"

    return {
        "schema": "nori.current_truth.v2",
        "checked_at": time.time(),
        "overall": overall,
        "checks": checks,
        "warnings": warnings,
        "blockers": blockers,
        "release_blockers": release_blockers,
        "admin_surface": {
            "status": admin.get("status"),
            "txAdminListening": admin.get("txAdminListening"),
            "gameListening": admin.get("gameListening"),
        },
        "platform_evidence": platform_evidence(diagnostics),
        "summary": {
            "workspace": workspace,
            "council": council,
            "roadmap": roadmap,
            "westline": westline.get("status") if isinstance(westline, dict) else None,
            "gameplay_hotfixes": gameplay.get("success"),
            "local_workers_ready": local_team.get("all_required_roles_ready"),
            "hosted_codex_used": local_team.get("hosted_codex_used"),
            # Retired native/avatar desktop checks stay visible here for history
            # but never decide current Workspace/Council readiness.
            "legacy_evidence": {
                "desktop_processes": diagnostics.get("desktop_processes"),
                "event_bus": diagnostics.get("event_bus"),
                "startup_authority": startup,
                "roadmap": roadmap,
                "local_team": local_team,
                "native_source": diagnostics.get("native_source"),
            },
        },
        "diagnostics": diagnostics,
    }


def write_report(path: Path = REPORT_PATH, report: dict[str, object] | None = None) -> Path:
    payload = build() if report is None else report
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(payload, indent=2, ensure_ascii=False), encoding="utf-8")
    temporary.replace(path)
    return path


def write_text_report(
    report: dict[str, object] | None = None,
    path: Path = TEXT_REPORT_PATH,
) -> Path:
    """Regenerate the owner-facing text rollup from live platform evidence.

    The previous text file could survive a source change while still printing
    retired native-desktop fields and a stale report path. Rewriting it from the
    current Workspace/Council report on every run prevents that stale claim.
    """
    payload = build() if report is None else report
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(render_text(payload) + "\n", encoding="utf-8")
    temporary.replace(path)
    return path


def render_text(report: dict[str, object]) -> str:
    checks = report["checks"]
    lines = [
        f"Nori Current Truth: {report['overall']}",
        "",
        f"Workspace listener (9444) reachable: {checks['workspace_listener_reachable']}",
        f"Workspace connected to Council: {checks['workspace_connected_to_council']}",
        f"Council listener (9107) reachable: {checks['council_listener_reachable']}",
        f"Council ready: {checks['council_ready']}",
        f"Council work available: {checks['council_work_available']}",
        f"Workspace release current: {checks['workspace_release_current']}",
        f"Council release current: {checks['council_release_current']}",
        f"West Line game healthy: {checks['westline_game_healthy']}",
        f"West Line gameplay hotfixes: {checks['westline_gameplay_hotfixes']}",
        f"West Line txAdmin/admin ready: {checks['westline_admin_ready']}",
    ]
    platform = report.get("platform_evidence") or {}
    workspace = platform.get("workspace") or {}
    council = platform.get("council") or {}
    lines.extend([
        "",
        "Live platform evidence (Workspace + Council):",
        f"- Workspace listener reachable: {workspace.get('reachable')} "
        f"(endpoint {workspace.get('endpoint')})",
        f"- Workspace connected to Council: {workspace.get('connected')}",
        f"- Workspace bridge revision: {workspace.get('bridge_revision')} "
        f"(expected {workspace.get('expected_bridge_revision')}, "
        f"current: {workspace.get('revision_current')})",
        f"- Council listener reachable: {council.get('reachable')} "
        f"(endpoint {council.get('endpoint')})",
        f"- Council model ready: {council.get('model_ready')}, "
        f"work available: {council.get('work_available')}",
        f"- Council work runtime revision: {council.get('work_runtime_revision')} "
        f"(expected {council.get('expected_work_runtime_revision')}, "
        f"current: {council.get('revision_current')})",
    ])
    warnings = report.get("warnings") or []
    if report["overall"] == "UPDATE_PENDING":
        lines.extend(["", "Update pending: live listeners are healthy but are serving an older verified source revision."])
    if warnings:
        lines.extend(["", "Warnings:"])
        lines.extend(f"- {warning}" for warning in warnings)
    blockers = report.get("blockers") or []
    if blockers:
        lines.extend(["", "Blockers:"])
        lines.extend(f"- {blocker}" for blocker in blockers)
    release_blockers = report.get("release_blockers") or []
    if release_blockers:
        lines.extend(["", "Release blockers:"])
        lines.extend(f"- {blocker}" for blocker in release_blockers)
    lines.extend(["", f"JSON report: {REPORT_PATH}", f"Text report: {TEXT_REPORT_PATH}"])
    return "\n".join(lines)


if __name__ == "__main__":
    report = build()
    path = write_report(report=report)
    write_text_report(report)
    payload = json.loads(path.read_text(encoding="utf-8"))
    print(render_text(payload))
