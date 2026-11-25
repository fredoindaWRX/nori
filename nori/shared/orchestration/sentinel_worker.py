"""NORI-native bounded event watchdog used by the Sentinel Knight.

This intentionally does not copy or embed an upstream event loop.  It accepts
small typed local events, records their lifecycle, and exposes a pull-based
queue to the NORI runtime.  Dispatch never performs an external side effect.
"""

from __future__ import annotations

from collections import deque
from dataclasses import dataclass
from pathlib import Path
from time import monotonic
from typing import Any
from uuid import uuid4
import json
from threading import RLock

from audit.nori_audit import record
from permissions.nori_policy import Policy


MAX_QUEUE = 256
MAX_EVENT_BYTES = 16 * 1024
MAX_TOPIC_CHARS = 96


@dataclass(frozen=True)
class SentinelEvent:
    event_id: str
    topic: str
    payload: dict[str, Any]
    created_at: float

    def as_dict(self) -> dict[str, Any]:
        return {"id": self.event_id, "topic": self.topic, "payload": json.loads(json.dumps(self.payload))}


class SentinelWorker:
    """Policy-gated, cancellation-aware local event queue."""

    def __init__(self, policy: Policy, audit_path: Path, maximum_queue: int = MAX_QUEUE):
        if type(maximum_queue) is not int or not 1 <= maximum_queue <= MAX_QUEUE:
            raise ValueError("maximum queue is invalid")
        self.policy = policy
        self.audit_path = Path(audit_path)
        self.maximum_queue = maximum_queue
        self._events: deque[SentinelEvent] = deque()
        self._cancelled: set[str] = set()
        self._lock = RLock()

    @staticmethod
    def _validate(topic: object, payload: object) -> tuple[str, dict[str, Any]]:
        if not isinstance(topic, str) or not topic or len(topic) > MAX_TOPIC_CHARS:
            raise ValueError("event topic is invalid")
        if any(character not in "abcdefghijklmnopqrstuvwxyz0123456789._-" for character in topic):
            raise ValueError("event topic is invalid")
        if not isinstance(payload, dict):
            raise ValueError("event payload is invalid")
        rendered = json.dumps(payload,ensure_ascii=False,allow_nan=False).encode("utf-8")
        if len(rendered) > MAX_EVENT_BYTES:
            raise ValueError("event payload is too large")
        return topic, json.loads(rendered.decode('utf-8'))

    def publish(self, topic: object, payload: object) -> dict[str, Any]:
        with self._lock:
            return self._publish(topic,payload)

    def _publish(self, topic: object, payload: object) -> dict[str, Any]:
        topic, payload = self._validate(topic, payload)
        decision = self.policy.decide("event_publish")
        event_id = str(uuid4())
        if not decision.allowed:
            record(self.audit_path, "sentinel_event", event_id, "denied", {"topic": topic, "reason": decision.reason})
            return {"status": "denied", "id": event_id, "reason": decision.reason}
        if len(self._events) >= self.maximum_queue:
            record(self.audit_path, "sentinel_event", event_id, "rejected", {"topic": topic, "reason": "queue_full"})
            return {"status": "rejected", "id": event_id, "reason": "queue_full"}
        event = SentinelEvent(event_id, topic, payload, monotonic())
        self._events.append(event)
        record(self.audit_path, "sentinel_event", event_id, "queued", {"topic": topic})
        return {"status": "queued", "event": event.as_dict()}

    def cancel(self, event_id: object) -> dict[str, str]:
        with self._lock:
            return self._cancel(event_id)

    def _cancel(self, event_id: object) -> dict[str, str]:
        if not isinstance(event_id, str) or not event_id or len(event_id)>128:
            raise ValueError("event id is invalid")
        decision = self.policy.decide('event_publish')
        if not decision.allowed:
            return {'status':'denied','reason':decision.reason}
        if not any(event.event_id == event_id for event in self._events):
            return {'status':'not_found','id':event_id}
        self._cancelled.add(event_id)
        record(self.audit_path, "sentinel_event", event_id, "cancelled")
        return {"status": "cancelled", "id": event_id}

    def next_event(self) -> dict[str, Any] | None:
        with self._lock:
            return self._next_event()

    def _next_event(self) -> dict[str, Any] | None:
        while self._events:
            event = self._events.popleft()
            if event.event_id in self._cancelled:
                self._cancelled.remove(event.event_id)
                record(self.audit_path, "sentinel_event", event.event_id, "skipped", {"reason": "cancelled"})
                continue
            record(self.audit_path, "sentinel_event", event.event_id, "delivered", {"topic": event.topic})
            return event.as_dict()
        return None

    def run(self, request: dict[str, Any]) -> dict[str, Any]:
        if not isinstance(request, dict) or set(request) - {"operation", "topic", "payload", "event_id"}:
            raise ValueError("sentinel request is invalid")
        operation = request.get("operation")
        if operation == "publish":
            return self.publish(request.get("topic"), request.get("payload"))
        if operation == "cancel":
            return self.cancel(request.get("event_id"))
        if operation == "next":
            decision = self.policy.decide('event_publish')
            if not decision.allowed:
                return {'status':'denied','reason':decision.reason}
            return {"status": "completed", "event": self.next_event()}
        raise ValueError("sentinel operation is invalid")
