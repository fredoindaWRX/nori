"""Local sensory state and bounded choice primitives for N.O.R.I.

This is capability plumbing: it records observations and makes an auditable
choice among caller supplied actions. It does not claim subjective experience
or grant unsafe autonomy.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Mapping

CHANNELS = ("sight", "hearing", "touch", "smell", "taste")


@dataclass
class SensoryState:
    observations: dict[str, dict[str, Any]] = field(default_factory=dict)

    def record(self, channel: str, value: Any, *, confidence: float = 1.0,
               source: str = "local") -> dict[str, Any]:
        if channel not in CHANNELS:
            raise ValueError(f"unsupported sensory channel: {channel}")
        if not 0.0 <= confidence <= 1.0:
            raise ValueError("confidence must be between 0 and 1")
        item = {"value": value, "confidence": confidence, "source": source,
                "observed_at": datetime.now(timezone.utc).isoformat()}
        self.observations[channel] = item
        return dict(item)

    def snapshot(self) -> dict[str, dict[str, Any]]:
        return {key: dict(value) for key, value in self.observations.items()}


def choose(candidates: list[Mapping[str, Any]], *, allowed: set[str] | None = None,
           requested: str | None = None) -> dict[str, Any]:
    """Select an explicitly allowed candidate and return an audit record."""
    allowed = set(allowed or ())
    if not candidates:
        return {"status": "NO_CANDIDATES", "selected": None}
    usable = [c for c in candidates if str(c.get("id", "")) in allowed]
    if requested is not None:
        usable = [c for c in usable if str(c.get("id")) == requested]
    if not usable:
        return {"status": "BLOCKED", "selected": None, "reason": "permission_gate"}
    selected = max(usable, key=lambda c: float(c.get("priority", 0)))
    return {"status": "SELECTED", "selected": str(selected["id"]),
            "reason": "highest_allowed_priority"}
