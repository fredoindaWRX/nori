"""NORI Sentinel agent package.

Sentinel is the security gate. It binds the first owner key, checks every
request before any Knight acts, records denials in SQLite, and exposes a kill
switch that other services can use to stop the council.
"""
from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
import sys
from typing import Any

_PACKAGE = Path(__file__).resolve().parents[1]
if str(_PACKAGE) not in sys.path:
    sys.path.insert(0, str(_PACKAGE))

from packages.knights.sentinel.security.gate import SentinelAudit, SentinelGate
from packages.knights.sentinel.security.key_binding import ImmutableOwnerMemory, TpmKeyStore
from packages.knights.sentinel.security.kill_switch import KillSwitch


@dataclass
class SentinelAgent:
    root: Path

    def __post_init__(self) -> None:
        self.root = Path(self.root)
        self.key_store = TpmKeyStore(self.root / "tpm")
        self.memory = ImmutableOwnerMemory(self.root / "letta")
        self.audit = SentinelAudit(self.root / "audit" / "sentinel.sqlite3")
        self.kill_switch = KillSwitch(self.root / "state" / "kill_switch.json")
        self.gate = SentinelGate(
            key_store=self.key_store,
            memory=self.memory,
            audit=self.audit,
            kill_switch=self.kill_switch,
        )

    def first_boot(self) -> dict[str, Any]:
        return self.gate.first_boot().as_dict()

    def authorize(self, request: dict[str, Any]) -> dict[str, Any]:
        return self.gate.authorize(request).as_dict()

    def trigger_kill_switch(self, reason: str) -> dict[str, Any]:
        state = self.kill_switch.trigger(reason)
        self.audit.record(
            actor="sentinel",
            action="kill_switch",
            outcome="DENY",
            reason=reason,
            locked_down=True,
        )
        return {"status": "kill_switch_active", "state": state}

    def status(self) -> dict[str, Any]:
        memory = self.memory.read()
        return {
            "schema": "nori.sentinel-status.v1",
            "owner_bound": memory is not None,
            "owner_fingerprint": memory.get("owner_fingerprint") if memory else None,
            "kill_switch": self.kill_switch.status(),
            "privilege": "lower_than_knights",
            "authority": "identity_gate",
        }


def create_sentinel_agent(root: Path) -> SentinelAgent:
    return SentinelAgent(root=root)
