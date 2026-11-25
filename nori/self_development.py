"""Owner-authorized local self-development task intake for N.O.R.I."""

from __future__ import annotations

import json
import os
import re
import time
from pathlib import Path
from typing import Any

from nori.workspace_operator import DEFAULT_ROOT, DEFAULT_LOCAL_WORKERS, create_workspace_task


TASK_FILE = DEFAULT_ROOT / "data" / "nori" / "self_development_tasks.jsonl"
RUNS_DIR = DEFAULT_ROOT / "data" / "nori" / "self_development_runs"
MAX_QUEUE_BYTES = 4 * 1024 * 1024
MAX_QUEUE_ROWS = 1024
MAX_QUEUE_ROW_BYTES = 64 * 1024
# Pre-rebrand lineage alias accepted only while normalizing legacy queue rows.
LEGACY_PROJECT_ROOT = Path(r"C:\Cortana")
LEGACY_WORKERS = dict(zip(("nori_local_architect", "nori_aider_writer", "nori_test_engineer",
                          "nori_security_auditor", "nori_local_reviewer"), DEFAULT_LOCAL_WORKERS))


def validate_task_id(value: Any) -> str:
    task_id = str(value or "").strip()
    if not re.fullmatch(r"nori-task-[A-Za-z0-9_-]{1,80}", task_id):
        raise ValueError("invalid_local_task_id")
    return task_id


def is_self_development_request(text: str) -> bool:
    lowered = str(text or "").casefold()
    signals = (
        "improve yourself",
        "improve your",
        "fix yourself",
        "fix your",
        "update yourself",
        "update your",
        "rewrite your",
        "change your own",
        "work on yourself",
        "self development",
        "self-development",
        "your source code",
        "your code",
    )
    return any(signal in lowered for signal in signals)


def queue_self_development_task(text: str) -> dict[str, Any]:
    request = str(text or "").strip()
    if not request:
        raise ValueError("self-development request is required")
    task = create_workspace_task(request, project_root=DEFAULT_ROOT)
    # Queue records are JSON-facing API data. Keep collection types stable for
    # the desktop, local workers, and audit files rather than leaking the
    # immutable tuples used by the internal workspace-task dataclass.
    task["workers"] = list(task.get("workers") or ())
    task["evidence_required"] = list(task.get("evidence_required") or ())
    task["scope"] = "nori_self_development"
    task["execution_boundary"] = {
        "workspace_only": True,
        "local_workers_only": True,
        "requires_tests": True,
        "requires_review": True,
        "requires_rollback_evidence": True,
        "immutable_owner_controls": True,
    }
    TASK_FILE.parent.mkdir(parents=True, exist_ok=True)
    with TASK_FILE.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps({"queued_at": time.time(), "task": task}, ensure_ascii=False) + "\n")
    return task


def prepare_local_task(task: dict[str, Any], *, runs_dir: Path = RUNS_DIR) -> dict[str, Any]:
    """Materialize one queued request as an auditable, local-only work packet.

    This is intentionally not a live-code executor. It creates the bounded
    worker brief and the evidence checklist that a local model, writer, tester,
    and reviewer must complete before a separate deployment step can occur.
    """
    task = normalize_queued_task(task)
    task_id = validate_task_id(task.get("task_id"))
    request = str(task.get("request") or "").strip()
    if not task_id or not request:
        raise ValueError("task_id_and_request_are_required")
    if Path(str(task.get("project_root") or "")).resolve() != DEFAULT_ROOT.resolve():
        raise ValueError("task_project_root_is_not_nori")

    runs = Path(runs_dir).absolute()
    if runs.resolve() != runs:
        raise ValueError("linked_self_development_runs_directory")
    target = runs / task_id
    target.mkdir(parents=True, exist_ok=False)
    manifest = {
        "schema": "nori.local_work_packet.v1",
        "task_id": task_id,
        "status": "prepared",
        "prepared_at": time.time(),
        "local_only": True,
        "project_root": str(DEFAULT_ROOT),
        "task": dict(task),
        "worker_sequence": [
            {"worker": "architect", "purpose": "inspect and produce a bounded plan"},
            {"worker": "neo", "purpose": "propose only the reviewed workspace change"},
            {"worker": "smith", "purpose": "propose specified regression and integration tests"},
            {"worker": "sentinel", "purpose": "enforce scope and authority boundaries"},
            {"worker": "trinity", "purpose": "review evidence before any deployment request"},
        ],
        "completion_evidence": list(task.get("evidence_required") or ()),
        "deployment": {
            "requested": False,
            "live_changes_allowed": False,
            "reason": "A prepared local task is not authority to change the live N.O.R.I. installation.",
        },
    }
    temporary = target / "work_packet.json.tmp"
    destination = target / "work_packet.json"
    with temporary.open("x", encoding="utf-8") as handle:
        handle.write(json.dumps(manifest, ensure_ascii=False, indent=2))
        handle.flush()
        os.fsync(handle.fileno())
    temporary.replace(destination)
    return {**manifest, "packet_path": str(destination)}


def normalize_queued_task(task: dict[str, Any]) -> dict[str, Any]:
    """Upgrade legacy signed-runtime queue rows into the current local contract.

    The live, integrity-pinned conversation bridge intentionally stays small.
    It can therefore enqueue an older task shape.  Normalizing here preserves
    its task id and request while adding the modern bounded-routing and evidence
    fields before any local worker sees the task.
    """
    if not isinstance(task, dict):
        raise ValueError("queued_task_must_be_an_object")
    task_id = validate_task_id(task.get("task_id"))
    request = str(task.get("request") or "").strip()
    if not task_id or not request:
        raise ValueError("task_id_and_request_are_required")
    # Queue rows written before the Aoki/Cortana -> Nori rebrand still carry the
    # legacy lineage root.  Accept that alias for migration only; the rebuilt
    # task below is always created against DEFAULT_ROOT, and any other foreign
    # project root keeps failing closed.
    incoming_root = Path(str(task.get("project_root") or "")).resolve()
    if incoming_root not in {DEFAULT_ROOT.resolve(), LEGACY_PROJECT_ROOT.resolve()}:
        raise ValueError("task_project_root_is_not_nori")

    current = create_workspace_task(request, project_root=DEFAULT_ROOT)
    current["task_id"] = task_id
    current["scope"] = "nori_self_development"
    current["local_only"] = True
    current["allow_hosted_escalation"] = False
    if isinstance(task.get("workers"), (list, tuple)) and task["workers"]:
        workers = [LEGACY_WORKERS.get(str(worker), str(worker)) for worker in task["workers"]]
        if any(worker not in DEFAULT_LOCAL_WORKERS for worker in workers):
            raise ValueError("unknown_native_self_development_worker")
        current["workers"] = workers
    current["routing"] = {
        **current["routing"],
        "primary_workers": list(current["workers"]),
        "hosted_codex": "not_needed",
    }
    current["execution_boundary"] = {
        "workspace_only": True,
        "local_workers_only": True,
        "requires_tests": True,
        "requires_review": True,
        "requires_rollback_evidence": True,
        "immutable_owner_controls": True,
    }
    return current


def stage_queued_local_tasks(*, task_file: Path = TASK_FILE, runs_dir: Path = RUNS_DIR) -> list[dict[str, Any]]:
    """Stage queued requests exactly once, preserving the original append-only queue."""
    if not Path(task_file).exists():
        return []
    source = Path(task_file).absolute()
    if source.resolve() != source:
        raise ValueError("linked_self_development_queue")
    with source.open("rb") as handle:
        data = handle.read(MAX_QUEUE_BYTES + 1)
    if len(data) > MAX_QUEUE_BYTES:
        raise ValueError("self_development_queue_too_large")
    rows = data.decode("utf-8").splitlines()
    if len(rows) > MAX_QUEUE_ROWS:
        raise ValueError("self_development_queue_too_many_rows")
    def unique(pairs):
        value = {}
        for key, item in pairs:
            if key in value:
                raise ValueError("duplicate_self_development_queue_key")
            value[key] = item
        return value
    def nonfinite(value):
        raise ValueError("nonfinite_self_development_queue_value")
    tasks = []
    # Validate the complete bounded snapshot before creating any packet.
    for raw in rows:
        if not raw.strip():
            continue
        if len(raw.encode("utf-8")) > MAX_QUEUE_ROW_BYTES:
            raise ValueError("self_development_queue_row_too_large")
        record = json.loads(raw, object_pairs_hook=unique, parse_constant=nonfinite)
        task = record.get("task") if isinstance(record, dict) else None
        if not isinstance(task, dict):
            continue
        tasks.append(normalize_queued_task(task))
    staged: list[dict[str, Any]] = []
    for normalized in tasks:
        target = Path(runs_dir) / normalized["task_id"]
        if target.exists() or target.is_symlink():
            # Preserve partial, legacy, failed and completed evidence alike.
            # Migration needs its own reviewed candidate, never an in-place reset.
            continue
        staged.append(prepare_local_task(normalized, runs_dir=runs_dir))
    return staged


def describe_queued_task(task: dict[str, Any]) -> str:
    routing = task["routing"]
    workers = ", ".join(routing["primary_workers"])
    return (
        "I created a local self-development task "
        f"{task['task_id']}. It is queued for {workers}. "
        "The task must be inspected, planned, implemented in a workspace, tested, "
        "reviewed, and backed by rollback evidence before any live update. "
        "I will report evidence rather than claim the change is complete."
    )
