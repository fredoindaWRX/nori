"""Local-first N.O.R.I. workspace operator.

This module is the deterministic contract that lets N.O.R.I. accept project
work through native Knight identities. External coding assistants are optional
development tools, not production replacements for those Knights.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any
import time
import uuid


SCHEMA = "nori.workspace_operator.v1"
# Follow the deployed component, never the caller's cwd or development checkout.
DEFAULT_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_LOCAL_WORKERS = (
    "architect",
    "neo",
    "smith",
    "sentinel",
    "trinity",
)
HOSTED_ESCALATION = "hosted_codex_supervisor"

TASK_KINDS = {
    "inspect",
    "plan",
    "edit",
    "test",
    "review",
    "package",
    "install",
    "operate",
}

SENSITIVE_WORDS = {
    "delete",
    "wipe",
    "format",
    "credential",
    "password",
    "token",
    "secret",
    "payment",
    "bank",
}


@dataclass(frozen=True)
class WorkspaceTask:
    task_id: str
    request: str
    project_root: str
    kind: str
    local_only: bool = True
    allow_hosted_escalation: bool = False
    status: str = "queued"
    created_at: float = field(default_factory=time.time)
    workers: tuple[str, ...] = DEFAULT_LOCAL_WORKERS
    evidence_required: tuple[str, ...] = (
        "files_changed",
        "tests_run",
        "result_summary",
        "blockers",
    )

    def dict(self) -> dict[str, Any]:
        return asdict(self)


def classify_request(text: str) -> str:
    lowered = str(text or "").casefold()
    if any(word in lowered for word in ("install", "apply", "restart", "start service")):
        return "install"
    if any(word in lowered for word in ("fix", "patch", "build", "implement", "change", "edit")):
        return "edit"
    if any(word in lowered for word in ("test", "verify", "green", "proof")):
        return "test"
    if any(word in lowered for word in ("review", "audit", "security")):
        return "review"
    if any(word in lowered for word in ("package", "release", "bundle")):
        return "package"
    if any(word in lowered for word in ("run", "operate", "control")):
        return "operate"
    if any(word in lowered for word in ("plan", "roadmap", "design")):
        return "plan"
    return "inspect"


def requires_escalation(text: str) -> bool:
    lowered = str(text or "").casefold()
    return any(word in lowered for word in SENSITIVE_WORDS)


def create_workspace_task(
    request: str,
    *,
    project_root: str | Path = DEFAULT_ROOT,
    allow_hosted_escalation: bool = False,
) -> dict[str, Any]:
    clean_request = str(request or "").strip()
    if not clean_request:
        raise ValueError("request is required")

    root = Path(project_root)
    kind = classify_request(clean_request)
    task = WorkspaceTask(
        task_id=f"nori-task-{uuid.uuid4().hex[:16]}",
        request=clean_request,
        project_root=str(root),
        kind=kind,
        local_only=not allow_hosted_escalation,
        allow_hosted_escalation=allow_hosted_escalation,
    ).dict()

    task["routing"] = route_workspace_task(task)
    return task


def route_workspace_task(task: dict[str, Any]) -> dict[str, Any]:
    request = str(task.get("request") or "")
    local_only = task.get("local_only") is not False
    sensitive = requires_escalation(request)

    if local_only:
        escalation = "blocked_by_local_only_policy" if sensitive else "not_needed"
    else:
        escalation = HOSTED_ESCALATION if sensitive else "not_needed"

    kind = str(task.get("kind") or classify_request(request))
    if kind not in TASK_KINDS:
        kind = "inspect"

    phases = ["inspect", "plan"]
    if kind in {"edit", "install", "operate"}:
        phases.extend(["implement", "test", "review"])
    elif kind in {"test", "review"}:
        phases.extend(["test", "review"])
    elif kind == "package":
        phases.extend(["test", "review", "package"])

    return {
        "mode": "nori_local_first",
        "kind": kind,
        "phases": phases,
        "primary_workers": list(task.get("workers") or DEFAULT_LOCAL_WORKERS),
        "hosted_codex": escalation,
        "evidence_required": list(task.get("evidence_required") or ()),
    }


def operator_status(root: Path = DEFAULT_ROOT) -> dict[str, Any]:
    roadmap = root / "ROADMAP_TRACKING.json"
    return {
        "schema": SCHEMA,
        "ready": False,
        "task_intake_available": True,
        "roadmap_available": roadmap.is_file(),
        "execution_qualified": False,
        "readiness_reason": "Native self-development execution requires workflow qualification; roadmap presence is not proof.",
        "project_root": str(root),
        "local_first": True,
        "default_workers": list(DEFAULT_LOCAL_WORKERS),
        "hosted_codex_policy": "last_resort_only",
        "roadmap": str(roadmap),
    }
