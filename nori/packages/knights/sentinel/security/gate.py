"""Sentinel authorization gate and SQLite audit log."""
from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
import re
import sqlite3
import time
from typing import Any

from packages.knights.sentinel.security.key_binding import ImmutableOwnerMemory, KeyStore, first_boot_bind, owner_fingerprint
from packages.knights.sentinel.security.kill_switch import KillSwitch


FULL_ADMIN = "FULL_ADMIN"
DENY = "DENY"
_FINGERPRINT = re.compile(r"[0-9a-f]{64}")


@dataclass(frozen=True)
class GateDecision:
    status: str
    reason: str
    authority: str | None = None
    owner_fingerprint: str | None = None
    locked_down: bool = False

    @property
    def allowed(self) -> bool:
        return self.status == FULL_ADMIN

    def as_dict(self) -> dict[str, Any]:
        return {
            "status": self.status,
            "reason": self.reason,
            "authority": self.authority,
            "owner_fingerprint": self.owner_fingerprint,
            "locked_down": self.locked_down,
        }


class SentinelAudit:
    def __init__(self, path: Path):
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with self._connect() as db:
            db.execute(
                "CREATE TABLE IF NOT EXISTS sentinel_audit ("
                "id INTEGER PRIMARY KEY AUTOINCREMENT,"
                "ts REAL NOT NULL,"
                "actor TEXT NOT NULL,"
                "action TEXT NOT NULL,"
                "outcome TEXT NOT NULL,"
                "reason TEXT NOT NULL,"
                "fingerprint TEXT,"
                "locked_down INTEGER NOT NULL DEFAULT 0)"
            )

    def _connect(self):
        return sqlite3.connect(self.path, timeout=10)

    def record(self, *, actor: str, action: str, outcome: str, reason: str,
               fingerprint: str | None = None, locked_down: bool = False) -> None:
        with self._connect() as db:
            db.execute(
                "INSERT INTO sentinel_audit "
                "(ts,actor,action,outcome,reason,fingerprint,locked_down) "
                "VALUES (?,?,?,?,?,?,?)",
                (time.time(), actor, action, outcome, reason, fingerprint, int(locked_down)),
            )

    def events(self) -> list[dict[str, Any]]:
        with self._connect() as db:
            rows = db.execute(
                "SELECT actor,action,outcome,reason,fingerprint,locked_down "
                "FROM sentinel_audit ORDER BY id"
            ).fetchall()
        return [
            {
                "actor": actor,
                "action": action,
                "outcome": outcome,
                "reason": reason,
                "fingerprint": fingerprint,
                "locked_down": bool(locked_down),
            }
            for actor, action, outcome, reason, fingerprint, locked_down in rows
        ]


class SentinelGate:
    """Every user or Knight request enters here before work begins."""

    def __init__(self, *, key_store: KeyStore, memory: ImmutableOwnerMemory,
                 audit: SentinelAudit, kill_switch: KillSwitch):
        self.key_store = key_store
        self.memory = memory
        self.audit = audit
        self.kill_switch = kill_switch

    def first_boot(self) -> GateDecision:
        binding = first_boot_bind(self.key_store, self.memory)
        self.audit.record(
            actor="sentinel",
            action="first_boot",
            outcome=FULL_ADMIN,
            reason="owner_key_bound",
            fingerprint=binding.owner_fingerprint,
        )
        return GateDecision(
            status=FULL_ADMIN,
            reason="owner_key_bound",
            authority="owner",
            owner_fingerprint=binding.owner_fingerprint,
        )

    def authorize(self, request: dict[str, Any]) -> GateDecision:
        if not isinstance(request, dict):
            raise ValueError("sentinel_request_invalid")
        actor = _clean_text(request.get("actor", "unknown"), "actor")
        action = _clean_text(request.get("action", "request"), "action")
        presented = request.get("owner_fingerprint")
        if not isinstance(presented, str) or not _FINGERPRINT.fullmatch(presented):
            return self._deny(actor, action, "owner_fingerprint_invalid", None)
        if self.kill_switch.active():
            return self._deny(actor, action, "kill_switch_active", presented)
        covenant = self.memory.read()
        if covenant is None:
            return self._deny(actor, action, "owner_not_bound", presented)
        expected = covenant.get("owner_fingerprint")
        local_public_key = self.key_store.public_key()
        local_fingerprint = owner_fingerprint(local_public_key)
        if expected != local_fingerprint:
            self.kill_switch.trigger("local_key_memory_mismatch")
            return self._deny(actor, action, "local_key_memory_mismatch", presented)
        if presented != expected:
            self.kill_switch.trigger("owner_key_mismatch")
            return self._deny(actor, action, "owner_key_mismatch", presented)
        self.audit.record(
            actor=actor,
            action=action,
            outcome=FULL_ADMIN,
            reason="owner_verified",
            fingerprint=presented,
        )
        return GateDecision(
            status=FULL_ADMIN,
            reason="owner_verified",
            authority="owner",
            owner_fingerprint=presented,
        )

    def _deny(self, actor: str, action: str, reason: str, fingerprint: str | None) -> GateDecision:
        self.audit.record(
            actor=actor,
            action=action,
            outcome=DENY,
            reason=reason,
            fingerprint=fingerprint,
            locked_down=self.kill_switch.active(),
        )
        return GateDecision(status=DENY, reason=reason, owner_fingerprint=fingerprint,
                            locked_down=self.kill_switch.active())


def _clean_text(value: Any, field: str) -> str:
    if not isinstance(value, str) or not value.strip() or len(value) > 96:
        raise ValueError(f"sentinel_{field}_invalid")
    return value.strip()
