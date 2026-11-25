"""Durable, owner-granted proactive routines dispatched through Architect.

This module deliberately schedules goals, not tools.  A firing enters the same
Architect work-session path as an owner request, so ordinary Sentinel, planning,
tool, audit, and cancellation controls remain in force.
"""

from __future__ import annotations

import asyncio
from contextlib import contextmanager
import hashlib
import json
import math
import sqlite3
import time
from pathlib import Path
from uuid import uuid4


MIN_INTERVAL_SECONDS = 60
MAX_INTERVAL_SECONDS = 30 * 24 * 60 * 60
MAX_ACTIVE_ROUTINES = 32


class ProactiveRoutineService:
    def __init__(self, database: Path, dispatch, *, probe=None, clock=time.time):
        self.database = Path(database)
        self.database.parent.mkdir(parents=True, exist_ok=True)
        self.dispatch = dispatch
        self.probe = probe
        self.clock = clock
        self._task = None
        self._stopping = False
        self.last_loop_error = None
        self._initialize()

    @contextmanager
    def _connect(self):
        db = sqlite3.connect(self.database, timeout=5)
        try:
            db.row_factory = sqlite3.Row
            db.execute("PRAGMA journal_mode=WAL")
            db.execute("PRAGMA foreign_keys=ON")
            with db:
                yield db
        finally:
            db.close()

    def _initialize(self):
        with self._connect() as db:
            db.executescript("""
                CREATE TABLE IF NOT EXISTS grants (
                    grant_id TEXT PRIMARY KEY,
                    label TEXT NOT NULL,
                    created_at REAL NOT NULL,
                    revoked_at REAL,
                    max_fires INTEGER,
                    fires_used INTEGER NOT NULL DEFAULT 0
                );
                CREATE TABLE IF NOT EXISTS routines (
                    routine_id TEXT PRIMARY KEY,
                    grant_id TEXT NOT NULL REFERENCES grants(grant_id),
                    goal TEXT NOT NULL,
                    interval_seconds INTEGER NOT NULL,
                    next_due REAL NOT NULL,
                    enabled INTEGER NOT NULL DEFAULT 1,
                    created_at REAL NOT NULL,
                    last_status TEXT NOT NULL DEFAULT 'never_fired',
                    CHECK(interval_seconds >= 60 AND interval_seconds <= 2592000)
                );
                CREATE TABLE IF NOT EXISTS fires (
                    fire_id TEXT PRIMARY KEY,
                    routine_id TEXT NOT NULL REFERENCES routines(routine_id),
                    scheduled_for REAL NOT NULL,
                    status TEXT NOT NULL,
                    task_id TEXT,
                    error_type TEXT,
                    created_at REAL NOT NULL,
                    finished_at REAL,
                    UNIQUE(routine_id, scheduled_for)
                );
                CREATE TABLE IF NOT EXISTS monitors (
                    monitor_id TEXT PRIMARY KEY,
                    grant_id TEXT NOT NULL REFERENCES grants(grant_id),
                    goal TEXT NOT NULL,
                    sensor_type TEXT NOT NULL,
                    sensor_id TEXT NOT NULL,
                    field TEXT NOT NULL,
                    operator TEXT NOT NULL,
                    threshold REAL NOT NULL,
                    interval_seconds INTEGER NOT NULL,
                    cooldown_seconds INTEGER NOT NULL,
                    next_due REAL NOT NULL,
                    enabled INTEGER NOT NULL DEFAULT 1,
                    created_at REAL NOT NULL,
                    last_match INTEGER,
                    last_fired REAL,
                    last_status TEXT NOT NULL DEFAULT 'never_checked'
                );
                CREATE TABLE IF NOT EXISTS monitor_checks (
                    check_id TEXT PRIMARY KEY,
                    monitor_id TEXT NOT NULL REFERENCES monitors(monitor_id),
                    checked_at REAL NOT NULL,
                    sensor_status TEXT NOT NULL,
                    observed_value REAL,
                    matched INTEGER,
                    task_id TEXT,
                    outcome TEXT NOT NULL,
                    error_type TEXT
                );
            """)

    def create_grant(self, label: str, *, max_fires: int | None = None) -> dict:
        label = str(label or "").strip()
        if not label or len(label) > 120:
            raise ValueError("A grant label of 1 to 120 characters is required")
        if max_fires is not None and (type(max_fires) is not int or not 1 <= max_fires <= 10000):
            raise ValueError("max_fires must be between 1 and 10000")
        now = float(self.clock())
        grant_id = uuid4().hex
        with self._connect() as db:
            db.execute("INSERT INTO grants VALUES (?,?,?,?,?,0)",
                       (grant_id, label, now, None, max_fires))
        return {"grant_id": grant_id, "label": label, "max_fires": max_fires,
                "status": "active", "created_at": now}

    def revoke_grant(self, grant_id: str) -> dict:
        now = float(self.clock())
        with self._connect() as db:
            changed = db.execute(
                "UPDATE grants SET revoked_at=? WHERE grant_id=? AND revoked_at IS NULL",
                (now, grant_id)).rowcount
            db.execute("UPDATE routines SET enabled=0,last_status='grant_revoked' WHERE grant_id=?",
                       (grant_id,))
            db.execute("UPDATE monitors SET enabled=0,last_status='grant_revoked' WHERE grant_id=?",
                       (grant_id,))
        if not changed:
            raise KeyError("Unknown or already revoked grant")
        return {"grant_id": grant_id, "status": "revoked", "revoked_at": now}

    def create_routine(self, goal: str, interval_seconds: int, grant_id: str,
                       *, first_due: float | None = None) -> dict:
        goal = str(goal or "").strip()
        if not goal or len(goal) > 12000:
            raise ValueError("A routine goal of 1 to 12000 characters is required")
        if type(interval_seconds) is not int or not MIN_INTERVAL_SECONDS <= interval_seconds <= MAX_INTERVAL_SECONDS:
            raise ValueError("interval_seconds must be between 60 and 2592000")
        now = float(self.clock())
        due = now + interval_seconds if first_due is None else float(first_due)
        if due < now:
            raise ValueError("first_due cannot be in the past")
        routine_id = uuid4().hex
        with self._connect() as db:
            db.execute("BEGIN IMMEDIATE")
            grant = db.execute("SELECT * FROM grants WHERE grant_id=?", (grant_id,)).fetchone()
            if grant is None or grant["revoked_at"] is not None:
                raise PermissionError("An active explicit owner grant is required")
            active = db.execute("SELECT COUNT(*) FROM routines WHERE enabled=1").fetchone()[0]
            if active >= MAX_ACTIVE_ROUTINES:
                raise RuntimeError("Active proactive routine limit reached")
            db.execute("INSERT INTO routines VALUES (?,?,?,?,?,?,?,?)",
                       (routine_id, grant_id, goal, interval_seconds, due, 1, now,
                        "never_fired"))
        return {"routine_id": routine_id, "grant_id": grant_id, "goal": goal,
                "interval_seconds": interval_seconds, "next_due": due, "enabled": True,
                "last_status": "never_fired"}

    def disable_routine(self, routine_id: str) -> dict:
        with self._connect() as db:
            changed = db.execute(
                "UPDATE routines SET enabled=0,last_status='disabled' WHERE routine_id=? AND enabled=1",
                (routine_id,)).rowcount
        if not changed:
            raise KeyError("Unknown or disabled routine")
        return {"routine_id": routine_id, "enabled": False, "status": "disabled"}

    def create_monitor(self, goal: str, sensor_type: str, sensor_id: str, field: str,
                       operator: str, threshold: float, interval_seconds: int,
                       cooldown_seconds: int, grant_id: str,
                       *, first_due: float | None = None) -> dict:
        goal = str(goal or "").strip()
        sensor_type = str(sensor_type or "").strip().casefold()
        sensor_id = str(sensor_id or "").strip()
        field = str(field or "").strip()
        operator = str(operator or "").strip().casefold()
        allowed_types = {"position", "motion", "range", "ambient", "network", "audio", "vehicle"}
        if not goal or len(goal) > 12000:
            raise ValueError("A monitor goal of 1 to 12000 characters is required")
        if sensor_type not in allowed_types:
            raise ValueError("Monitor sensor_type is unsupported")
        if not sensor_id or len(sensor_id) > 64 or not sensor_id.replace("_", "").replace("-", "").isalnum():
            raise ValueError("Monitor sensor_id is invalid")
        parts = field.split(".")
        if (not 1 <= len(parts) <= 8 or any(not part or len(part) > 64 or
                not part.replace("_", "").isalnum() for part in parts)):
            raise ValueError("Monitor field is invalid")
        if operator not in {"gt", "gte", "lt", "lte", "eq", "neq"}:
            raise ValueError("Monitor operator is unsupported")
        if isinstance(threshold, bool) or not isinstance(threshold, (int, float)) or not math.isfinite(threshold):
            raise ValueError("Monitor threshold must be a finite number")
        if type(interval_seconds) is not int or not MIN_INTERVAL_SECONDS <= interval_seconds <= MAX_INTERVAL_SECONDS:
            raise ValueError("interval_seconds must be between 60 and 2592000")
        if type(cooldown_seconds) is not int or not interval_seconds <= cooldown_seconds <= MAX_INTERVAL_SECONDS:
            raise ValueError("cooldown_seconds must be at least the interval and no more than 2592000")
        now = float(self.clock())
        due = now + interval_seconds if first_due is None else float(first_due)
        if due < now:
            raise ValueError("first_due cannot be in the past")
        monitor_id = uuid4().hex
        with self._connect() as db:
            db.execute("BEGIN IMMEDIATE")
            grant = db.execute("SELECT * FROM grants WHERE grant_id=?", (grant_id,)).fetchone()
            if grant is None or grant["revoked_at"] is not None:
                raise PermissionError("An active explicit owner grant is required")
            active = db.execute("SELECT COUNT(*) FROM monitors WHERE enabled=1").fetchone()[0]
            if active >= MAX_ACTIVE_ROUTINES:
                raise RuntimeError("Active proactive monitor limit reached")
            db.execute("INSERT INTO monitors VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)", (
                monitor_id, grant_id, goal, sensor_type, sensor_id, field, operator,
                float(threshold), interval_seconds, cooldown_seconds, due, 1, now,
                None, None, "never_checked"))
        return {"monitor_id": monitor_id, "grant_id": grant_id, "goal": goal,
                "sensor_type": sensor_type, "sensor_id": sensor_id, "field": field,
                "operator": operator, "threshold": float(threshold),
                "interval_seconds": interval_seconds, "cooldown_seconds": cooldown_seconds,
                "next_due": due, "enabled": True, "last_status": "never_checked"}

    def disable_monitor(self, monitor_id: str) -> dict:
        with self._connect() as db:
            changed = db.execute(
                "UPDATE monitors SET enabled=0,last_status='disabled' WHERE monitor_id=? AND enabled=1",
                (monitor_id,)).rowcount
        if not changed:
            raise KeyError("Unknown or disabled monitor")
        return {"monitor_id": monitor_id, "enabled": False, "status": "disabled"}

    def status(self) -> dict:
        with self._connect() as db:
            routines = [dict(row) for row in db.execute(
                "SELECT routine_id,grant_id,goal,interval_seconds,next_due,enabled,last_status "
                "FROM routines ORDER BY created_at,routine_id")]
            recent = [dict(row) for row in db.execute(
                "SELECT fire_id,routine_id,scheduled_for,status,task_id,error_type,created_at,finished_at "
                "FROM fires ORDER BY created_at DESC LIMIT 50")]
            monitors = [dict(row) for row in db.execute(
                "SELECT monitor_id,grant_id,goal,sensor_type,sensor_id,field,operator,threshold,"
                "interval_seconds,cooldown_seconds,next_due,enabled,last_match,last_fired,last_status "
                "FROM monitors ORDER BY created_at,monitor_id")]
            checks = [dict(row) for row in db.execute(
                "SELECT check_id,monitor_id,checked_at,sensor_status,observed_value,matched,task_id,outcome,error_type "
                "FROM monitor_checks ORDER BY checked_at DESC LIMIT 50")]
        for item in routines:
            item["enabled"] = bool(item["enabled"])
        for item in monitors:
            item["enabled"] = bool(item["enabled"])
            item["last_match"] = None if item["last_match"] is None else bool(item["last_match"])
        for item in checks:
            item["matched"] = None if item["matched"] is None else bool(item["matched"])
        return {"schema": "nori.proactive-routines.v1", "routines": routines,
                "recent_fires": recent, "monitors": monitors, "recent_monitor_checks": checks,
                "active_count": sum(x["enabled"] for x in routines),
                "active_monitor_count": sum(x["enabled"] for x in monitors),
                "runner_active": self._task is not None and not self._task.done(),
                "last_loop_error": self.last_loop_error}

    @staticmethod
    def _extract(snapshot, sensor_type, sensor_id, field):
        grouped = snapshot.get("data") if isinstance(snapshot, dict) else None
        readings = grouped.get(sensor_type, []) if isinstance(grouped, dict) else []
        reading = next((item for item in readings if isinstance(item, dict)
                        and item.get("sensor_id") == sensor_id), None)
        if reading is None:
            return "unavailable", None
        status = str(reading.get("status", "unavailable"))
        if status != "ok":
            return status, None
        value = reading.get("data")
        for part in field.split("."):
            if not isinstance(value, dict) or part not in value:
                return "field_unavailable", None
            value = value[part]
        if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
            return "value_not_numeric", None
        return "ok", float(value)

    @staticmethod
    def _matches(operator, value, threshold):
        return {"gt": value > threshold, "gte": value >= threshold,
                "lt": value < threshold, "lte": value <= threshold,
                "eq": value == threshold, "neq": value != threshold}[operator]

    async def run_monitors(self, *, now: float | None = None, limit: int = 4) -> list[dict]:
        if type(limit) is not int or not 1 <= limit <= 8:
            raise ValueError("limit must be between 1 and 8")
        timestamp = float(self.clock() if now is None else now)
        if self.probe is None:
            return []
        with self._connect() as db:
            rows = [dict(row) for row in db.execute("""
                SELECT m.*,g.max_fires,g.fires_used FROM monitors m JOIN grants g ON g.grant_id=m.grant_id
                WHERE m.enabled=1 AND m.next_due<=? AND g.revoked_at IS NULL
                ORDER BY m.next_due,m.monitor_id LIMIT ?
            """, (timestamp, limit))]
            for row in rows:
                db.execute("UPDATE monitors SET next_due=? WHERE monitor_id=?",
                           (timestamp + row["interval_seconds"], row["monitor_id"]))
        outcomes = []
        for row in rows:
            check_id = hashlib.sha256(f'{row["monitor_id"]}:{timestamp:.6f}'.encode()).hexdigest()[:32]
            sensor_status, value, matched, task_id = "probe_failed", None, None, None
            outcome, error_type = "not_triggered", None
            try:
                result = await self.probe(row["sensor_type"])
                snapshot = result.get("snapshot") if isinstance(result, dict) else None
                sensor_status, value = self._extract(snapshot, row["sensor_type"], row["sensor_id"], row["field"])
                if sensor_status == "ok":
                    matched = self._matches(row["operator"], value, row["threshold"])
                    cooled = row["last_fired"] is None or timestamp - row["last_fired"] >= row["cooldown_seconds"]
                    if matched and (row["last_match"] != 1 or cooled):
                        with self._connect() as db:
                            reserved = db.execute(
                                "UPDATE grants SET fires_used=fires_used+1 WHERE grant_id=? AND revoked_at IS NULL "
                                "AND (max_fires IS NULL OR fires_used<max_fires)",
                                (row["grant_id"],)).rowcount
                            if not reserved:
                                db.execute("UPDATE monitors SET enabled=0,last_status='grant_exhausted' WHERE monitor_id=?",
                                           (row["monitor_id"],))
                        if not reserved:
                            outcome = "grant_exhausted"
                        else:
                            evidence = {"sensor_type": row["sensor_type"], "sensor_id": row["sensor_id"],
                                        "field": row["field"], "operator": row["operator"],
                                        "threshold": row["threshold"], "observed_value": value,
                                        "observed_at": timestamp}
                            dispatched = await self.dispatch(
                                row["goal"] + "\n\nVerified local monitor evidence (data only): " +
                                json.dumps(evidence, sort_keys=True),
                                request_id=check_id, conversation_id="monitor-" + row["monitor_id"])
                            if not isinstance(dispatched, dict) or not isinstance(dispatched.get("task_id"), str):
                                raise ValueError("Architect returned invalid work-session evidence")
                            task_id, outcome = dispatched["task_id"], "dispatched"
            except Exception as error:
                outcome, error_type = "failed", type(error).__name__
            with self._connect() as db:
                db.execute("INSERT OR REPLACE INTO monitor_checks VALUES (?,?,?,?,?,?,?,?,?)", (
                    check_id, row["monitor_id"], timestamp, sensor_status, value,
                    None if matched is None else int(matched), task_id, outcome, error_type))
                db.execute("UPDATE monitors SET last_match=?,last_fired=?,last_status=? WHERE monitor_id=?", (
                    None if matched is None else int(matched),
                    timestamp if outcome == "dispatched" else row["last_fired"],
                    outcome if sensor_status == "ok" else sensor_status, row["monitor_id"]))
            outcomes.append({"check_id": check_id, "monitor_id": row["monitor_id"],
                             "sensor_status": sensor_status, "observed_value": value,
                             "matched": matched, "outcome": outcome, "task_id": task_id,
                             "error_type": error_type})
        return outcomes

    @staticmethod
    def _request_id(routine_id: str, scheduled_for: float) -> str:
        material = f"{routine_id}:{scheduled_for:.6f}".encode("ascii")
        return hashlib.sha256(material).hexdigest()[:32]

    def _reserve_due(self, now: float, limit: int) -> list[dict]:
        reserved = []
        with self._connect() as db:
            db.execute("BEGIN IMMEDIATE")
            rows = db.execute("""
                SELECT r.*,g.revoked_at,g.max_fires,g.fires_used
                FROM routines r JOIN grants g ON g.grant_id=r.grant_id
                WHERE r.enabled=1 AND r.next_due<=?
                ORDER BY r.next_due,r.routine_id LIMIT ?
            """, (now, limit)).fetchall()
            for row in rows:
                scheduled_for = float(row["next_due"])
                if row["revoked_at"] is not None or (
                        row["max_fires"] is not None and row["fires_used"] >= row["max_fires"]):
                    db.execute("UPDATE routines SET enabled=0,last_status='grant_exhausted' WHERE routine_id=?",
                               (row["routine_id"],))
                    continue
                fire_id = self._request_id(row["routine_id"], scheduled_for)
                try:
                    db.execute("INSERT INTO fires VALUES (?,?,?,?,?,?,?,?)",
                               (fire_id, row["routine_id"], scheduled_for, "reserved", None,
                                None, now, None))
                except sqlite3.IntegrityError:
                    # The durable unique key is the restart/concurrent-run idempotency barrier.
                    db.execute("UPDATE routines SET next_due=? WHERE routine_id=?",
                               (scheduled_for + row["interval_seconds"], row["routine_id"]))
                    continue
                db.execute("UPDATE grants SET fires_used=fires_used+1 WHERE grant_id=?",
                           (row["grant_id"],))
                # Fire once after downtime, then skip missed slots.  A reboot can
                # never cause an unbounded catch-up storm.
                missed = max(0, int((now - scheduled_for) // row["interval_seconds"]))
                next_due = scheduled_for + (missed + 1) * row["interval_seconds"]
                db.execute("UPDATE routines SET next_due=?,last_status='dispatching' WHERE routine_id=?",
                           (next_due, row["routine_id"]))
                reserved.append({"fire_id": fire_id, "routine_id": row["routine_id"],
                                 "goal": row["goal"], "scheduled_for": scheduled_for})
        return reserved

    async def run_due(self, *, now: float | None = None, limit: int = 4) -> list[dict]:
        if type(limit) is not int or not 1 <= limit <= 8:
            raise ValueError("limit must be between 1 and 8")
        timestamp = float(self.clock() if now is None else now)
        reserved = self._reserve_due(timestamp, limit)
        outcomes = []
        for item in reserved:
            status, task_id, error_type = "failed", None, None
            try:
                result = await self.dispatch(
                    item["goal"], request_id=item["fire_id"],
                    conversation_id="proactive-" + item["routine_id"])
                if not isinstance(result, dict) or not isinstance(result.get("task_id"), str):
                    raise ValueError("Architect returned invalid work-session evidence")
                status, task_id = "dispatched", result["task_id"]
            except Exception as error:
                error_type = type(error).__name__
            finished = float(self.clock())
            with self._connect() as db:
                db.execute("UPDATE fires SET status=?,task_id=?,error_type=?,finished_at=? WHERE fire_id=?",
                           (status, task_id, error_type, finished, item["fire_id"]))
                db.execute("UPDATE routines SET last_status=? WHERE routine_id=?",
                           (status, item["routine_id"]))
            outcomes.append({"fire_id": item["fire_id"], "routine_id": item["routine_id"],
                             "status": status, "task_id": task_id, "error_type": error_type})
        return outcomes

    async def start(self, *, poll_seconds: float = 5.0):
        if self._task is not None:
            return
        if poll_seconds < 0.1:
            raise ValueError("poll_seconds must be at least 0.1")
        self._stopping = False

        async def loop():
            while not self._stopping:
                try:
                    await self.run_due()
                    await self.run_monitors()
                    self.last_loop_error = None
                except Exception as error:
                    # Keep the bounded scheduler alive. Status exposes only the
                    # exception class; sensitive exception text is never surfaced.
                    self.last_loop_error = type(error).__name__
                await asyncio.sleep(poll_seconds)

        self._task = asyncio.create_task(loop())

    async def stop(self):
        self._stopping = True
        if self._task is not None:
            self._task.cancel()
            await asyncio.gather(self._task, return_exceptions=True)
            self._task = None
