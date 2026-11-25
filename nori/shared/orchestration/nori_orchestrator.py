"""NORI-owned worker orchestration primitives."""
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Dict, List
import os
from pathlib import Path
import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from audit.nori_audit import record

@dataclass
class WorkerSpec:
    name: str
    model_id: str
    max_workers: int = 1
    permissions: List[str] = field(default_factory=list)
    capabilities: List[str] = field(default_factory=list)

class Orchestrator:
    def __init__(self, policy=None):
        self.workers: Dict[str, WorkerSpec] = {}
        self.audit: List[dict] = []
        self.policy = policy
        self.audit_path = Path(os.getenv("NORI_AUDIT_PATH", str(Path(__file__).resolve().parents[2] / "Logs" / "runtime-audit.jsonl")))
    def register(self, spec: WorkerSpec) -> None:
        if not spec.name or not spec.model_id or spec.max_workers < 1:
            raise ValueError("invalid worker specification")
        self.workers[spec.name] = spec
        self._record("register", spec.name)
    def plan(self, task: str, capability: str = None) -> dict:
        if not task.strip(): raise ValueError("task is required")
        chosen = next((name for name, spec in self.workers.items()
                       if capability is None or capability in spec.capabilities), None)
        decision = self.policy.decide("plan") if self.policy else None
        result = {"task": task, "worker": chosen,
                  "allowed": chosen is not None and (decision.allowed if decision else False),
                  "requires_approval": decision.requires_approval if decision else True,
                  "reason": "no_matching_worker" if chosen is None else (decision.reason if decision else "policy_required")}
        self._record("plan", task)
        return result
    def _record(self, action, subject):
        event={"time":datetime.now(timezone.utc).isoformat(),"action":action,"subject":subject}
        self.audit.append(event)
        record(self.audit_path, action, subject, outcome="recorded")

