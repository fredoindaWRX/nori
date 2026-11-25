"""Nori v2 autonomous worker controller.

Workers execute bounded work. The v2 control plane retains authority, policy,
capability activation, and completion truth.
"""
from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any

from nori.development_workers.base import DevelopmentWorkerAdapter, WorkOrder
from nori.shared.control_plane.v2 import (
    ActionIntent,
    CapabilityRegistry,
    CompletionGate,
    EvidenceReceipt,
    GuardrailEngine,
)


@dataclass(frozen=True)
class AutonomousRun:
    outcome: str
    worker: str
    changed_files: tuple[str, ...]
    evidence: dict[str, Any]
    error_type: str | None = None
    detail: str = ""


class AutonomousWorkerController:
    """Admit, execute, and verify a worker without surrendering authority."""

    CAPABILITY_ID = "cline-autonomous-worker"

    def __init__(self, registry: CapabilityRegistry, adapter: DevelopmentWorkerAdapter):
        self.registry = registry
        self.adapter = adapter
        self.guardrails = GuardrailEngine()
        self.completion = CompletionGate()

    def _approved(self) -> bool:
        item = self.registry.snapshot()["capabilities"].get(self.CAPABILITY_ID)
        return bool(item and item["primitive"] == "worker" and item["status"] == "approved")

    async def run(self, order: WorkOrder, *, intent: ActionIntent | None = None) -> AutonomousRun:
        if not self._approved():
            return AutonomousRun("blocked", self.adapter.metadata.worker_id, (), {},
                                 "CAPABILITY_NOT_APPROVED", "The v2 worker capability is not approved")
        decision = self.guardrails.evaluate(intent or ActionIntent(order.original_goal, target=str(order.bounded_scope)))
        if decision.outcome != "allowed":
            return AutonomousRun(decision.outcome, self.adapter.metadata.worker_id, (), {},
                                 "OWNER_CHECKPOINT", "; ".join(decision.reasons))

        result = await self.adapter.dispatch(order)
        receipts = []
        if result.stdout:
            receipts.append(EvidenceReceipt.create("execution", order.task_id, result.stdout,
                                                   detail="worker execution transcript"))
        for changed in result.changed_files:
            path = Path(changed)
            if path.is_file():
                receipts.append(EvidenceReceipt.create("readback", str(path), path.read_bytes(),
                                                       detail="post-execution file readback"))
        required = ["execution"] + (["readback"] if order.allowed_files else [])
        evidence = self.completion.evaluate(required, receipts)
        completed = result.success and evidence["complete"]
        return AutonomousRun(
            "completed" if completed else "failed",
            self.adapter.metadata.worker_id,
            tuple(str(path) for path in result.changed_files),
            evidence,
            result.error_type or (None if completed else "EVIDENCE_INCOMPLETE"),
            result.stderr,
        )
