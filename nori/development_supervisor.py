"""Durable coordination state for NORI development collaborators.

This monitor intentionally does not try to drive a third-party coding client.
It records the evidence that a human, NORI worker, Codex, or external editor
has actually acknowledged and advanced a bounded task.  A live process alone
is never considered proof that its assigned work is active or complete.
"""
from __future__ import annotations

import json
from pathlib import Path
import re
import time


TASK_ID = re.compile(r"[A-Z][A-Z0-9-]{2,79}")
ACTIVE_STATES = {"claimed", "implementing", "review_requested"}
WAITING_STATES = {"waiting_for_auth", "waiting_for_owner", "blocked"}
FINAL_STATES = {"verified", "deployed", "cancelled"}
ALL_STATES = ACTIVE_STATES | WAITING_STATES | FINAL_STATES | {"changes_requested"}
TRANSITIONS = {
    "claimed": {"implementing", "waiting_for_auth", "waiting_for_owner", "blocked", "cancelled"},
    "implementing": {"review_requested", "waiting_for_auth", "waiting_for_owner", "blocked", "cancelled"},
    "review_requested": {"changes_requested", "verified", "waiting_for_owner", "blocked", "cancelled"},
    "changes_requested": {"implementing", "waiting_for_auth", "waiting_for_owner", "blocked", "cancelled"},
    "waiting_for_auth": {"implementing", "cancelled"},
    "waiting_for_owner": {"implementing", "cancelled"},
    "blocked": {"implementing", "cancelled"},
    "verified": {"deployed", "cancelled"},
    "deployed": set(),
    "cancelled": set(),
}


class TaskStateError(ValueError):
    """The supplied ledger operation conflicts with the durable task state."""


class DevelopmentSupervisor:
    """File-backed task ledger with explicit acknowledgement and evidence gates."""

    SCHEMA = "nori.development-supervisor.v1"

    def __init__(self, state_path: Path, events_path: Path | None = None, clock=time.time):
        self.state_path = Path(state_path)
        self.events_path = Path(events_path or self.state_path.with_suffix(".events.jsonl"))
        self.clock = clock

    def _read(self):
        if not self.state_path.exists():
            return {"schema": self.SCHEMA, "tasks": {}}
        try:
            state = json.loads(self.state_path.read_text(encoding="utf-8"))
        except (OSError, ValueError, UnicodeError) as error:
            raise TaskStateError("development task ledger is unreadable") from error
        if not isinstance(state, dict) or state.get("schema") != self.SCHEMA or not isinstance(state.get("tasks"), dict):
            raise TaskStateError("development task ledger has an unsupported schema")
        return state

    def _write(self, state):
        self.state_path.parent.mkdir(parents=True, exist_ok=True)
        temp = self.state_path.with_name(self.state_path.name + ".tmp")
        temp.write_text(json.dumps(state, indent=2, ensure_ascii=False, sort_keys=True), encoding="utf-8")
        temp.replace(self.state_path)

    def _event(self, event, task_id, **detail):
        self.events_path.parent.mkdir(parents=True, exist_ok=True)
        record = {"schema": self.SCHEMA, "time": self.clock(), "event": event, "task_id": task_id, **detail}
        with self.events_path.open("a", encoding="utf-8") as handle:
            handle.write(json.dumps(record, ensure_ascii=False, sort_keys=True) + "\n")

    @staticmethod
    def _text(value, field, maximum=4000):
        if not isinstance(value, str) or not value.strip() or len(value) > maximum:
            raise TaskStateError(field + " must be non-empty text")
        return value.strip()

    def create(self, task_id, assignee, scope, source_revision, timeout_seconds=900):
        if not isinstance(task_id, str) or not TASK_ID.fullmatch(task_id):
            raise TaskStateError("task_id must use uppercase letters, digits, and hyphens")
        assignee = self._text(assignee, "assignee", 100)
        scope = self._text(scope, "scope")
        source_revision = self._text(source_revision, "source_revision", 256)
        if type(timeout_seconds) is not int or not 30 <= timeout_seconds <= 7 * 24 * 60 * 60:
            raise TaskStateError("timeout_seconds is outside the accepted range")
        state = self._read()
        if task_id in state["tasks"]:
            raise TaskStateError("task_id already exists")
        now = self.clock()
        task = {
            "task_id": task_id, "assignee": assignee, "scope": scope, "source_revision": source_revision,
            "state": "claimed", "created_at": now, "updated_at": now, "acknowledged_at": None,
            "last_heartbeat_at": None, "timeout_seconds": timeout_seconds, "evidence": [], "blocker": None,
        }
        state["tasks"][task_id] = task
        self._write(state)
        self._event("created", task_id, assignee=assignee, state="claimed")
        return task.copy()

    def get(self, task_id):
        task = self._read()["tasks"].get(task_id)
        if not isinstance(task, dict):
            raise TaskStateError("unknown task_id")
        return json.loads(json.dumps(task))

    def acknowledge(self, task_id, assignee):
        state = self._read(); task = state["tasks"].get(task_id)
        if not task:
            raise TaskStateError("unknown task_id")
        if self._text(assignee, "assignee", 100).casefold() != task["assignee"].casefold():
            raise TaskStateError("only the recorded assignee can acknowledge")
        if task["state"] not in {"claimed", "waiting_for_auth", "waiting_for_owner", "blocked", "changes_requested"}:
            raise TaskStateError("task cannot be acknowledged in its current state")
        now = self.clock()
        task.update(state="implementing", acknowledged_at=now, last_heartbeat_at=now, updated_at=now, blocker=None)
        self._write(state); self._event("acknowledged", task_id, assignee=task["assignee"])
        return self.get(task_id)

    def heartbeat(self, task_id, assignee, note=""):
        state = self._read(); task = state["tasks"].get(task_id)
        if not task:
            raise TaskStateError("unknown task_id")
        if self._text(assignee, "assignee", 100).casefold() != task["assignee"].casefold():
            raise TaskStateError("only the recorded assignee can heartbeat")
        if task["state"] not in {"implementing", "review_requested"}:
            raise TaskStateError("heartbeat requires an acknowledged active task")
        note = "" if note is None else self._text(note, "note", 1000)
        now = self.clock(); task["last_heartbeat_at"] = now; task["updated_at"] = now
        self._write(state); self._event("heartbeat", task_id, assignee=task["assignee"], note=note)
        return self.get(task_id)

    def add_evidence(self, task_id, assignee, kind, reference, summary):
        state = self._read(); task = state["tasks"].get(task_id)
        if not task:
            raise TaskStateError("unknown task_id")
        if self._text(assignee, "assignee", 100).casefold() != task["assignee"].casefold():
            raise TaskStateError("only the recorded assignee can add evidence")
        entry = {"kind": self._text(kind, "kind", 100), "reference": self._text(reference, "reference", 1000),
                 "summary": self._text(summary, "summary", 2000), "recorded_at": self.clock()}
        task["evidence"].append(entry); task["updated_at"] = entry["recorded_at"]
        self._write(state); self._event("evidence_recorded", task_id, assignee=task["assignee"], kind=entry["kind"])
        return self.get(task_id)

    def transition(self, task_id, assignee, target, blocker=None):
        state = self._read(); task = state["tasks"].get(task_id)
        if not task:
            raise TaskStateError("unknown task_id")
        if self._text(assignee, "assignee", 100).casefold() != task["assignee"].casefold():
            raise TaskStateError("only the recorded assignee can transition")
        if target not in ALL_STATES or target not in TRANSITIONS[task["state"]]:
            raise TaskStateError("invalid task state transition")
        if target == "verified" and not task["evidence"]:
            raise TaskStateError("verified requires recorded evidence")
        if target in {"blocked", "waiting_for_auth", "waiting_for_owner"}:
            blocker = self._text(blocker, "blocker", 2000)
        elif blocker is not None:
            raise TaskStateError("blocker is only accepted for blocked or waiting states")
        task["state"] = target; task["blocker"] = blocker; task["updated_at"] = self.clock()
        self._write(state); self._event("transitioned", task_id, assignee=task["assignee"], state=target)
        return self.get(task_id)

    def snapshot(self, now=None):
        now = self.clock() if now is None else now
        tasks = [self.get(task_id) for task_id in sorted(self._read()["tasks"])]
        for task in tasks:
            recent = task["last_heartbeat_at"] or task["acknowledged_at"] or task["created_at"]
            task["stalled"] = task["state"] in ACTIVE_STATES and now - recent > task["timeout_seconds"]
            task["attention"] = ("stalled" if task["stalled"] else task["state"])
        return {"schema": self.SCHEMA, "observed_at": now, "tasks": tasks,
                "summary": {"total": len(tasks), "active": sum(t["state"] in ACTIVE_STATES for t in tasks),
                            "stalled": sum(t["stalled"] for t in tasks),
                            "waiting": sum(t["state"] in WAITING_STATES for t in tasks)}}

