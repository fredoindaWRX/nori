"""Sentinel kill switch state."""
from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
import json
import os
import tempfile
import time


@dataclass
class KillSwitch:
    path: Path

    def __post_init__(self) -> None:
        self.path = Path(self.path)

    def active(self) -> bool:
        return self.path.exists()

    def trigger(self, reason: str) -> dict:
        if not isinstance(reason, str) or not reason.strip():
            raise ValueError("kill_switch_reason_invalid")
        self.path.parent.mkdir(parents=True, exist_ok=True)
        value = {"schema": "nori.sentinel-kill-switch.v1",
                 "active": True, "reason": reason.strip(), "ts": time.time()}
        descriptor, temporary = tempfile.mkstemp(prefix=".kill-switch.", dir=self.path.parent)
        try:
            with os.fdopen(descriptor, "w", encoding="utf-8", newline="\n") as handle:
                json.dump(value, handle, separators=(",", ":"))
                handle.write("\n")
                handle.flush()
                os.fsync(handle.fileno())
            os.replace(temporary, self.path)
        except Exception:
            try:
                os.unlink(temporary)
            except FileNotFoundError:
                pass
            raise
        return value

    def status(self) -> dict:
        if not self.active():
            return {"active": False}
        return json.loads(self.path.read_text(encoding="utf-8"))
