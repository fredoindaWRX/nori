"""Threaded delivery watchdog for NORI's in-process Council bus.

It observes delivery only.  It never sends work, changes authorization, or
restarts agents.  A missing delivery is an audit signal for the supervisor.
"""
from __future__ import annotations

import json
from pathlib import Path
import threading
import time
from typing import Any


class BusWatchdog:
    """Record a single audit warning for each uninterrupted quiet period."""

    def __init__(self, audit_path: Path, *, stall_seconds: float = 30.0,
                 check_interval: float = 5.0, clock=time.monotonic):
        if not isinstance(stall_seconds, (int, float)) or stall_seconds < 1:
            raise ValueError("stall_seconds must be at least one second")
        if not isinstance(check_interval, (int, float)) or not 0.05 <= check_interval <= stall_seconds:
            raise ValueError("check_interval must be positive and no longer than stall_seconds")
        self.audit_path = Path(audit_path)
        self.stall_seconds = float(stall_seconds)
        self.check_interval = float(check_interval)
        self._clock = clock
        self._started_at: float | None = None
        self._last_delivery_at: float | None = None
        self._stall_reported = False
        self._lock = threading.Lock()
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None

    def note_delivery(self, _message: Any = None) -> None:
        """Observe a successfully authorized queue delivery."""
        with self._lock:
            self._last_delivery_at = self._clock()
            self._stall_reported = False

    def _record(self, detail: dict[str, Any]) -> None:
        self.audit_path.parent.mkdir(parents=True, exist_ok=True)
        with self.audit_path.open("a", encoding="utf-8") as handle:
            handle.write(json.dumps(detail, sort_keys=True) + "\n")

    def check_once(self, now: float | None = None) -> bool:
        """Return True only when this check creates a new stall audit event."""
        now = self._clock() if now is None else now
        with self._lock:
            baseline = self._last_delivery_at if self._last_delivery_at is not None else self._started_at
            if baseline is None:
                self._started_at = now
                baseline = now
            quiet_seconds = now - baseline
            if self._stall_reported or quiet_seconds < self.stall_seconds:
                return False
            self._stall_reported = True
            last_delivery_at = self._last_delivery_at
        self._record({
            "event": "bus_stall_warning",
            "time_monotonic": now,
            "quiet_seconds": round(quiet_seconds, 3),
            "last_delivery_at": last_delivery_at,
            "action": "observed_only",
        })
        return True

    def _run(self) -> None:
        while not self._stop.wait(self.check_interval):
            try:
                self.check_once()
            except Exception:
                # A diagnostics failure must never kill or impede Council routing.
                pass

    def start(self) -> None:
        with self._lock:
            if self._thread and self._thread.is_alive():
                return
            self._stop.clear()
            self._started_at = self._clock()
            self._thread = threading.Thread(target=self._run, name="nori-bus-watchdog", daemon=True)
            self._thread.start()

    def stop(self, timeout: float = 2.0) -> None:
        self._stop.set()
        thread = self._thread
        if thread:
            thread.join(timeout=timeout)
        if thread and not thread.is_alive():
            self._thread = None
