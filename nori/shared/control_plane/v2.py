"""NORI v2 control-plane primitives.

This module turns the recurring architecture in the owner's v2 source corpus
into enforceable local contracts:

* knowledge is selectively retrieved context;
* skills are repeatable local workflows;
* connectors reach live external systems;
* workers isolate large or independent work;
* risky actions require an owner checkpoint;
* untrusted data can never grant authority;
* completion requires evidence appropriate to the claim;
* imported sources retain their bytes, digest, provenance, and verification
  state instead of becoming unattributed model memory.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from hashlib import sha256
import json
import os
from pathlib import Path
import re
import shutil
from threading import RLock
import time
from typing import Any, Iterable
from uuid import uuid4


_ID = re.compile(r"[a-z0-9][a-z0-9._-]{0,79}")
_PRIMITIVES = frozenset({"knowledge", "skill", "connector", "worker"})
_RISKS = frozenset({"low", "moderate", "high", "critical"})
_STATUS = frozenset({"candidate", "approved", "disabled"})
_PROJECT_TYPES = {
    "application": ("deep", ("problem", "users", "outcomes", "scope", "ux", "data", "interfaces", "security", "verification", "delivery")),
    "workflow": ("standard", ("trigger", "inputs", "steps", "tools", "outputs", "exceptions", "verification", "ownership")),
    "client": ("standard", ("client", "audience", "offer", "pages", "brand", "conversion", "delivery")),
    "utility": ("tight", ("problem", "input", "output", "constraints", "verification", "distribution")),
    "campaign": ("creative", ("audience", "goal", "message", "channels", "assets", "measurement", "learning_loop")),
}


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _identifier(value: Any, label: str = "identifier") -> str:
    if not isinstance(value, str):
        raise ValueError(f"{label} is invalid")
    raw = value.strip().casefold()
    if not raw or "/" in raw or "\\" in raw or ".." in raw or "\x00" in raw:
        raise ValueError(f"{label} is invalid")
    value = re.sub(r"[^a-z0-9._-]+", "-", raw).strip("-._")
    if not _ID.fullmatch(value):
        raise ValueError(f"{label} is invalid")
    return value


def _text(value: Any, label: str, maximum: int = 4096, *, optional: bool = False) -> str:
    if optional and (value is None or value == ""):
        return ""
    if not isinstance(value, str) or not value.strip() or len(value) > maximum:
        raise ValueError(f"{label} is invalid")
    return value.strip()


def _list(value: Iterable[str] | None, label: str, *, maximum: int = 64) -> list[str]:
    if value is None:
        return []
    if not isinstance(value, (list, tuple, set)):
        raise ValueError(f"{label} must be a list")
    result = []
    for item in value:
        item = _text(item, label, 200)
        if item.casefold() not in {existing.casefold() for existing in result}:
            result.append(item)
    if len(result) > maximum:
        raise ValueError(f"{label} has too many entries")
    return result


def _atomic_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    staged = path.with_suffix(path.suffix + ".tmp")
    with staged.open("w", encoding="utf-8", newline="\n") as handle:
        json.dump(payload, handle, ensure_ascii=False, indent=2, sort_keys=True)
        handle.write("\n")
        handle.flush()
        os.fsync(handle.fileno())
    for attempt in range(6):
        try:
            staged.replace(path)
            return
        except PermissionError as exc:
            if getattr(exc, "winerror", None) not in {5, 32, 33} or attempt == 5:
                raise
            time.sleep(0.02 * (attempt + 1))


class CapabilityRegistry:
    """Auditable capability inventory and deterministic primitive router."""

    SCHEMA = "nori.capability-registry.v2"

    def __init__(self, path: str | Path):
        self.path = Path(path).resolve()
        self._lock = RLock()
        if not self.path.exists():
            _atomic_json(self.path, {"schema": self.SCHEMA, "revision": 0,
                                     "updated_at": _now(), "capabilities": {}})
        self._read()

    def _read(self) -> dict[str, Any]:
        value = json.loads(self.path.read_text(encoding="utf-8"))
        if (not isinstance(value, dict) or value.get("schema") != self.SCHEMA
                or not isinstance(value.get("capabilities"), dict)
                or type(value.get("revision")) is not int):
            raise ValueError("capability registry is invalid")
        return value

    def register(self, name: str, primitive: str, description: str, *,
                 triggers: Iterable[str] = (), permissions: Iterable[str] = (),
                 risk: str = "low", external: bool = False,
                 cost_model: str = "local", status: str = "candidate",
                 provenance: str = "owner") -> dict[str, Any]:
        capability_id = _identifier(name, "capability name")
        if primitive not in _PRIMITIVES:
            raise ValueError("capability primitive is invalid")
        if risk not in _RISKS or status not in _STATUS:
            raise ValueError("capability policy is invalid")
        if type(external) is not bool:
            raise ValueError("external must be boolean")
        value = {"id": capability_id, "name": _text(name, "capability name", 120),
                 "primitive": primitive, "description": _text(description, "description", 2000),
                 "triggers": _list(triggers, "trigger"),
                 "permissions": _list(permissions, "permission"), "risk": risk,
                 "external": external, "cost_model": _text(cost_model, "cost model", 300),
                 "status": status, "provenance": _text(provenance, "provenance", 300),
                 "updated_at": _now()}
        with self._lock:
            registry = self._read()
            previous = registry["capabilities"].get(capability_id)
            value["created_at"] = previous.get("created_at", _now()) if previous else _now()
            registry["capabilities"][capability_id] = value
            registry["revision"] += 1
            registry["updated_at"] = _now()
            _atomic_json(self.path, registry)
        return dict(value)

    def set_status(self, capability: str, status: str) -> dict[str, Any]:
        capability_id = _identifier(capability, "capability")
        if status not in _STATUS:
            raise ValueError("capability status is invalid")
        with self._lock:
            registry = self._read()
            if capability_id not in registry["capabilities"]:
                raise KeyError("capability not found")
            registry["capabilities"][capability_id]["status"] = status
            registry["capabilities"][capability_id]["updated_at"] = _now()
            registry["revision"] += 1
            registry["updated_at"] = _now()
            _atomic_json(self.path, registry)
            return dict(registry["capabilities"][capability_id])

    @staticmethod
    def choose_primitive(*, always_known: bool = False, repeatable: bool = False,
                         live_external: bool = False, oversized: bool = False) -> str:
        selected = [name for name, enabled in (("knowledge", always_known), ("skill", repeatable),
                                                ("connector", live_external), ("worker", oversized)) if enabled]
        if len(selected) != 1:
            raise ValueError("exactly one primitive criterion is required")
        return selected[0]

    def route(self, prompt: str, *, primitive: str | None = None,
              include_candidates: bool = False) -> list[dict[str, Any]]:
        prompt = _text(prompt, "prompt", 16000).casefold()
        if primitive is not None and primitive not in _PRIMITIVES:
            raise ValueError("capability primitive is invalid")
        results = []
        for item in self._read()["capabilities"].values():
            if item["status"] == "disabled" or (item["status"] != "approved" and not include_candidates):
                continue
            if primitive and item["primitive"] != primitive:
                continue
            score = sum(trigger.casefold() in prompt for trigger in item["triggers"])
            if score or not item["triggers"]:
                results.append(dict(item, score=score))
        return sorted(results, key=lambda item: (-item["score"], item["risk"], item["id"]))

    def snapshot(self) -> dict[str, Any]:
        return self._read()


@dataclass(frozen=True)
class ActionIntent:
    action: str
    target: str = ""
    outward_facing: bool = False
    destructive: bool = False
    financial: bool = False
    changes_permissions: bool = False
    handles_credentials: bool = False
    transmits_sensitive_data: bool = False
    source_trust: str = "owner"
    estimated_cost: float = 0.0


@dataclass(frozen=True)
class ActionDecision:
    outcome: str
    reasons: tuple[str, ...]
    requires_owner_confirmation: bool


class GuardrailEngine:
    """Policy decision point. Data never grants authority to perform actions."""

    def evaluate(self, intent: ActionIntent) -> ActionDecision:
        if not isinstance(intent, ActionIntent):
            raise TypeError("action intent is required")
        # Autonomous work orders need room for scope and acceptance criteria.
        # Execution remains bounded by permissions, allow-lists, and evidence.
        _text(intent.action, "action", 16000)
        if intent.estimated_cost < 0:
            raise ValueError("estimated cost is invalid")
        reasons = []
        if intent.source_trust not in {"owner", "system", "verified", "untrusted"}:
            raise ValueError("source trust is invalid")
        if intent.source_trust == "untrusted" and (intent.changes_permissions or intent.handles_credentials):
            return ActionDecision("denied", ("Untrusted content cannot change credentials, permissions, or policy.",), False)
        if intent.destructive:
            reasons.append("destructive action")
        if intent.outward_facing:
            reasons.append("outward-facing action")
        if intent.financial or intent.estimated_cost > 0:
            reasons.append("financial impact")
        if intent.changes_permissions:
            reasons.append("permission change")
        if intent.handles_credentials:
            reasons.append("credential access")
        if intent.transmits_sensitive_data:
            reasons.append("sensitive-data transmission")
        if reasons:
            return ActionDecision("approval_required", tuple(reasons), True)
        return ActionDecision("allowed", (), False)


@dataclass(frozen=True)
class EvidenceReceipt:
    kind: str
    subject: str
    digest: str
    observed_at: str
    detail: str = ""

    @classmethod
    def create(cls, kind: str, subject: str, observed: bytes | str, detail: str = "") -> "EvidenceReceipt":
        if kind not in {"test", "readback", "screenshot", "api", "execution", "review"}:
            raise ValueError("evidence kind is invalid")
        subject = _text(subject, "evidence subject", 500)
        payload = observed.encode("utf-8") if isinstance(observed, str) else observed
        if not isinstance(payload, bytes) or not payload:
            raise ValueError("evidence payload is invalid")
        return cls(kind, subject, sha256(payload).hexdigest(), _now(), _text(detail, "detail", 2000, optional=True))


class CompletionGate:
    """Require evidence types before accepting a completion claim."""

    def evaluate(self, required: Iterable[str], receipts: Iterable[EvidenceReceipt]) -> dict[str, Any]:
        required_set = set(_list(list(required), "required evidence", maximum=10))
        receipt_list = list(receipts)
        if any(not isinstance(receipt, EvidenceReceipt) for receipt in receipt_list):
            raise TypeError("invalid evidence receipt")
        supplied = {receipt.kind for receipt in receipt_list}
        missing = sorted(required_set - supplied)
        return {"complete": not missing, "required": sorted(required_set),
                "supplied": sorted(supplied), "missing": missing,
                "receipts": [receipt.__dict__ for receipt in receipt_list]}


class SourceCatalog:
    """Content-addressed archive of owner-supplied and researched sources."""

    SCHEMA = "nori.source-catalog.v2"

    def __init__(self, root: str | Path):
        self.root = Path(root).resolve()
        self.files = self.root / "files"
        self.path = self.root / "catalog.json"
        self.files.mkdir(parents=True, exist_ok=True)
        self._lock = RLock()
        if not self.path.exists():
            _atomic_json(self.path, {"schema": self.SCHEMA, "revision": 0,
                                     "updated_at": _now(), "sources": {}})
        self._read()

    def _read(self) -> dict[str, Any]:
        value = json.loads(self.path.read_text(encoding="utf-8"))
        if (not isinstance(value, dict) or value.get("schema") != self.SCHEMA
                or not isinstance(value.get("sources"), dict)):
            raise ValueError("source catalog is invalid")
        return value

    def ingest(self, source: str | Path, *, title: str, topics: Iterable[str] = (),
               provenance: str = "owner-supplied", verification: str = "unverified") -> dict[str, Any]:
        path = Path(source).resolve()
        if not path.is_file() or path.is_symlink() or path.stat().st_size > 8 * 1024 * 1024:
            raise ValueError("source file is missing, linked, or too large")
        if verification not in {"unverified", "partially_verified", "verified", "rejected"}:
            raise ValueError("verification state is invalid")
        raw = path.read_bytes()
        digest = sha256(raw).hexdigest()
        suffix = path.suffix.lower() if len(path.suffix) <= 12 else ".bin"
        destination = self.files / (digest + suffix)
        if not destination.exists():
            staged = destination.with_suffix(destination.suffix + ".tmp")
            shutil.copyfile(path, staged)
            staged.replace(destination)
        record = {"id": "source-" + digest[:24], "sha256": digest,
                  "title": _text(title, "source title", 300), "topics": _list(topics, "topic"),
                  "provenance": _text(provenance, "provenance", 300),
                  "verification": verification, "bytes": len(raw),
                  "media_type": "text/plain" if suffix in {".txt", ".md"} else "application/octet-stream",
                  "stored_path": destination.relative_to(self.root).as_posix(),
                  "original_name": path.name, "ingested_at": _now()}
        with self._lock:
            catalog = self._read()
            previous = catalog["sources"].get(record["id"])
            if previous:
                record["ingested_at"] = previous["ingested_at"]
            catalog["sources"][record["id"]] = record
            catalog["revision"] += 1
            catalog["updated_at"] = _now()
            _atomic_json(self.path, catalog)
        return dict(record)

    def set_verification(self, source_id: str, verification: str) -> dict[str, Any]:
        source_id = _identifier(source_id, "source id")
        if verification not in {"unverified", "partially_verified", "verified", "rejected"}:
            raise ValueError("verification state is invalid")
        with self._lock:
            catalog = self._read()
            if source_id not in catalog["sources"]:
                raise KeyError("source not found")
            catalog["sources"][source_id]["verification"] = verification
            catalog["sources"][source_id]["verified_at"] = _now()
            catalog["revision"] += 1
            catalog["updated_at"] = _now()
            _atomic_json(self.path, catalog)
            return dict(catalog["sources"][source_id])

    def snapshot(self) -> dict[str, Any]:
        return self._read()


class ProjectIncubator:
    """Type-aware project briefs with explicit quality gates and checkpoints."""

    SCHEMA = "nori.project-brief.v2"

    @staticmethod
    def types() -> dict[str, dict[str, Any]]:
        return {name: {"rigor": rigor, "sections": list(sections)}
                for name, (rigor, sections) in _PROJECT_TYPES.items()}

    def create(self, name: str, project_type: str, answers: dict[str, str]) -> dict[str, Any]:
        project_id = _identifier(name, "project name")
        if project_type not in _PROJECT_TYPES:
            raise ValueError("project type is invalid")
        if not isinstance(answers, dict):
            raise ValueError("answers must be an object")
        rigor, sections = _PROJECT_TYPES[project_type]
        unknown = set(answers) - set(sections)
        if unknown:
            raise ValueError("unknown project brief sections: " + ", ".join(sorted(unknown)))
        normalized = {section: _text(answers.get(section, ""), section, 8000, optional=True)
                      for section in sections}
        missing = [section for section, value in normalized.items() if not value]
        return {"schema": self.SCHEMA, "id": project_id, "name": _text(name, "project name", 160),
                "project_type": project_type, "rigor": rigor, "sections": normalized,
                "quality_gate": {"ready": not missing, "missing": missing},
                "status": "ready" if not missing else "draft", "created_at": _now(),
                "checkpoint_id": uuid4().hex}

    @staticmethod
    def phases(brief: dict[str, Any]) -> list[dict[str, Any]]:
        if not isinstance(brief, dict) or brief.get("schema") != ProjectIncubator.SCHEMA:
            raise ValueError("project brief is invalid")
        if not brief.get("quality_gate", {}).get("ready"):
            raise ValueError("project brief is not ready")
        names = ["foundation", "implementation", "verification", "delivery"]
        return [{"id": f"phase-{index:02d}", "name": name, "status": "pending",
                 "checkpoint_required": True, "depends_on": [] if index == 1 else [f"phase-{index-1:02d}"]}
                for index, name in enumerate(names, 1)]
