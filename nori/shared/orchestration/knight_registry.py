"""Validated NORI Knights roster and edition activation profiles.

The registry describes NORI-owned roles. Upstream projects are provenance and
design references only; they never become executable merely by appearing in
the roster.
"""
from dataclasses import dataclass
import json
from pathlib import Path


EXPECTED_KNIGHTS = frozenset({
    "neo", "trinity", "morpheus", "apoc", "oracle", "merovingian",
    "architect", "keymaker", "smith", "tank", "machine", "sentinel",
})
ACTIVATABLE_STATUSES = frozenset({"native", "native_proposal"})
EDITION_ROLES = {
    "home": EXPECTED_KNIGHTS,
    "server": EXPECTED_KNIGHTS - {"morpheus"},
    "robotics": frozenset({
        "neo", "trinity", "oracle", "merovingian", "architect",
        "keymaker", "smith", "tank", "machine", "sentinel",
    }),
}

# Ordered candidates for contracts whose native implementation can be operated
# by more than one Knight. A candidate must be active for the selected edition
# and hold the contract grant; this table never expands edition membership.
CAPABILITY_OVERLAP = {
    "ide": {"candidates": ("morpheus", "neo"), "permission": "ide_read"},
    "research": {"candidates": ("keymaker", "oracle"), "permission": "research_report"},
    "hardware": {"candidates": ("tank", "machine"), "permission": "hardware_read"},
}

# Explicit peer relationships keep useful overlap deliberate.  The lead owns
# the typed result, backups can take the same contract when eligible, reviewers
# inspect evidence, and contributors supply a narrower supporting capability.
# This is coordination metadata only: it never grants a permission or activates
# a Knight that the edition profile excluded.
COLLABORATION_GRAPH = {
    "coding": {"lead": "neo", "backups": ("morpheus", "smith"),
               "reviewers": ("oracle",), "contributors": ("architect",)},
    "plugins": {"lead": "trinity", "backups": ("neo",),
                "reviewers": ("sentinel",), "contributors": ("architect",)},
    "ide": {"lead": "morpheus", "backups": ("neo",),
            "reviewers": ("oracle",), "contributors": ("smith",)},
    "browser": {"lead": "apoc", "backups": ("trinity",),
                "reviewers": ("keymaker",), "contributors": ("sentinel",)},
    "knowledge": {"lead": "oracle", "backups": ("keymaker",),
                  "reviewers": ("merovingian",), "contributors": ("apoc",)},
    "memory": {"lead": "merovingian", "backups": ("oracle",),
               "reviewers": ("sentinel",), "contributors": ("architect",)},
    "orchestration": {"lead": "architect", "backups": ("trinity",),
                      "reviewers": ("sentinel",), "contributors": ("merovingian",)},
    "research": {"lead": "keymaker", "backups": ("oracle", "apoc"),
                 "reviewers": ("oracle",), "contributors": ("merovingian",)},
    "execution": {"lead": "smith", "backups": ("neo",),
                  "reviewers": ("sentinel",), "contributors": ("tank",)},
    "hardware": {"lead": "tank", "backups": ("machine",),
                 "reviewers": ("sentinel",), "contributors": ("oracle",)},
    "inference": {"lead": "machine", "backups": ("architect",),
                  "reviewers": ("sentinel",), "contributors": ("merovingian",)},
    "events": {"lead": "sentinel", "backups": ("architect",),
               "reviewers": ("merovingian",), "contributors": ("tank",)},
}
WATCHMAN_ONLY_CAPABILITIES = frozenset({"robotics", "motion", "actuator"})


@dataclass(frozen=True)
class Knight:
    id: str
    role: str
    capabilities: tuple[str, ...]
    implementation_status: str
    permissions: tuple[str, ...]

    @property
    def activatable(self) -> bool:
        return self.implementation_status in ACTIVATABLE_STATUSES


class KnightRegistry:
    def __init__(self, roster_path: Path):
        payload = json.loads(Path(roster_path).read_text(encoding="utf-8"))
        entries = payload.get("knights")
        if not isinstance(entries, list):
            raise ValueError("knights roster must contain a list")
        knights = {}
        for entry in entries:
            if not isinstance(entry, dict):
                raise ValueError("knight entries must be objects")
            knight_id = entry.get("id")
            role = entry.get("role")
            capabilities = entry.get("capabilities")
            permissions = entry.get("permissions")
            status = entry.get("implementation_status")
            if (not isinstance(knight_id, str) or not knight_id or
                    knight_id in knights):
                raise ValueError("knight ids must be nonempty and unique")
            if not isinstance(role, str) or not role.strip():
                raise ValueError(f"{knight_id} has invalid role")
            if (not isinstance(capabilities, list) or not capabilities or
                    any(not isinstance(value, str) or not value for value in capabilities)):
                raise ValueError(f"{knight_id} has invalid capabilities")
            if (not isinstance(permissions, list) or
                    any(not isinstance(value, str) or not value for value in permissions)):
                raise ValueError(f"{knight_id} has invalid permissions")
            if not isinstance(status, str) or not status:
                raise ValueError(f"{knight_id} has no implementation status")
            knights[knight_id] = Knight(
                knight_id, role.strip(), tuple(capabilities), status,
                tuple(permissions))
        if set(knights) != EXPECTED_KNIGHTS:
            missing = sorted(EXPECTED_KNIGHTS - set(knights))
            extra = sorted(set(knights) - EXPECTED_KNIGHTS)
            raise ValueError(f"roster mismatch: missing={missing}, extra={extra}")
        self.name = payload.get("name")
        self.version = payload.get("version")
        self.knights = knights
        for capability, overlap in CAPABILITY_OVERLAP.items():
            candidates = overlap["candidates"]
            permission = overlap["permission"]
            if not candidates or len(candidates) != len(set(candidates)):
                raise ValueError(f"{capability} has invalid overlap candidates")
            for knight_id in candidates:
                knight = self.knights[knight_id]
                if permission not in knight.permissions:
                    raise ValueError(f"{knight_id} lacks {capability} overlap permission")
        for capability, team in COLLABORATION_GRAPH.items():
            members = (team["lead"], *team["backups"], *team["reviewers"],
                       *team["contributors"])
            if any(member not in self.knights for member in members):
                raise ValueError(f"{capability} collaboration references unknown Knight")
            if team["lead"] in team["backups"]:
                raise ValueError(f"{capability} collaboration repeats its lead")

    def for_edition(self, edition: str, activatable_only: bool = True) -> tuple[Knight, ...]:
        if edition not in EDITION_ROLES:
            raise ValueError("unknown NORI edition")
        selected = (self.knights[name] for name in sorted(EDITION_ROLES[edition]))
        if activatable_only:
            selected = (knight for knight in selected if knight.activatable)
        return tuple(selected)

    def select(self, capability: str, edition: str) -> Knight | None:
        if not isinstance(capability, str) or not capability:
            raise ValueError("capability is required")
        return next((knight for knight in self.for_edition(edition)
                     if capability in knight.capabilities), None)

    def resolve(self, capability: str, edition: str) -> tuple[Knight, bool] | None:
        """Resolve an active, permission-compatible primary or fallback Knight."""
        if capability in WATCHMAN_ONLY_CAPABILITIES:
            return None
        overlap = CAPABILITY_OVERLAP.get(capability)
        if overlap is None:
            knight = self.select(capability, edition)
            return (knight, False) if knight else None
        active = {knight.id: knight for knight in self.for_edition(edition)}
        for index, knight_id in enumerate(overlap["candidates"]):
            knight = active.get(knight_id)
            if knight and overlap["permission"] in knight.permissions:
                return knight, index > 0
        return None

    def readiness(self) -> tuple[dict, ...]:
        """Return declared readiness without promoting planned references."""
        return tuple({
            "id": knight.id,
            "role": knight.role,
            "capabilities": list(knight.capabilities),
            "implementation_status": knight.implementation_status,
            "activatable": knight.activatable,
            "fallback_for": sorted(
                capability for capability, overlap in CAPABILITY_OVERLAP.items()
                if knight.id in overlap["candidates"][1:]
            ),
        } for knight in (self.knights[name] for name in sorted(self.knights)))

    def collaboration(self, capability: str, edition: str) -> dict | None:
        """Return the active peer team for a capability without adding authority."""
        if capability not in COLLABORATION_GRAPH:
            return None
        active = {knight.id for knight in self.for_edition(edition)}
        team = COLLABORATION_GRAPH[capability]
        return {
            "capability": capability,
            "lead": team["lead"] if team["lead"] in active else None,
            "backups": [value for value in team["backups"] if value in active],
            "reviewers": [value for value in team["reviewers"] if value in active],
            "contributors": [value for value in team["contributors"] if value in active],
        }
