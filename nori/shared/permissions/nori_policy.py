"""Small NORI-owned permission evaluator."""
from dataclasses import dataclass
from typing import FrozenSet

@dataclass(frozen=True)
class Decision:
    allowed: bool
    requires_approval: bool
    reason: str

class Policy:
    def __init__(self, grants=()): self.grants: FrozenSet[str] = frozenset(grants)
    def decide(self, action: str, approved: bool = False) -> Decision:
        if action not in self.grants: return Decision(False, False, "action_not_granted")
        if action in {"erase_disk", "send_external", "control_vehicle", "place_order"} and not approved:
            return Decision(False, True, "explicit_approval_required")
        return Decision(True, False, "granted")
