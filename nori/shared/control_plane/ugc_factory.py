"""Nori-native UGC Factory workflow.

Local-first project state and planning only. External image/video providers are
referenced through Nori's capability registry and remain candidate-only until
an owner explicitly approves them.
"""
from __future__ import annotations

import json
from pathlib import Path
from threading import RLock
from typing import Any

from .v2 import CapabilityRegistry, EvidenceReceipt, _atomic_json, _identifier, _now, _text


class UGCFactory:
    SCHEMA = "nori.ugc-factory-project.v2"
    STATUSES = ("PLANNING", "GENERATING", "WAITING FOR PROVIDER", "REVIEW REQUIRED", "ASSEMBLING", "VERIFYING", "COMPLETE", "BLOCKED")

    def __init__(self, root: str | Path, registry: CapabilityRegistry):
        self.root = Path(root).resolve(); self.root.mkdir(parents=True, exist_ok=True)
        self.path = self.root / "projects.json"; self.registry = registry; self._lock = RLock()
        if not self.path.exists(): _atomic_json(self.path, {"schema": self.SCHEMA, "revision": 0, "projects": {}})

    def _read(self) -> dict[str, Any]:
        data = json.loads(self.path.read_text(encoding="utf-8"))
        if data.get("schema") != self.SCHEMA or not isinstance(data.get("projects"), dict): raise ValueError("UGC project store is invalid")
        return data

    def create(self, product: str, offer: str, audience: str, topic: str, *, creator: dict[str, Any], aspect_ratio: str = "9:16", duration_seconds: int = 15, genre: str = "product-demo") -> dict[str, Any]:
        if aspect_ratio not in {"9:16", "1:1", "16:9", "4:5"} or type(duration_seconds) is not int or not 1 <= duration_seconds <= 180: raise ValueError("UGC format is invalid")
        if not isinstance(creator, dict) or not _text(creator.get("name", ""), "creator name", 120): raise ValueError("creator is invalid")
        project_id = _identifier(topic, "project topic"); now = _now()
        project = {"id": project_id, "status": "PLANNING", "product": _text(product, "product"), "offer": _text(offer, "offer"), "audience": _text(audience, "audience"), "topic": _text(topic, "topic"), "creator": dict(creator), "format": {"aspect_ratio": aspect_ratio, "duration_seconds": duration_seconds, "genre": _text(genre, "genre", 80)}, "scenes": [], "assets": [], "revisions": [], "selected_takes": [], "final_outputs": [], "evidence": [], "created_at": now, "updated_at": now}
        with self._lock:
            data = self._read(); data["projects"][project_id] = project; data["revision"] += 1; _atomic_json(self.path, data)
        return dict(project)

    def plan(self, project_id: str, scene_count: int = 3) -> dict[str, Any]:
        if type(scene_count) is not int or not 1 <= scene_count <= 20: raise ValueError("scene count is invalid")
        with self._lock:
            data = self._read(); project = self._required(data, project_id)
            duration = project["format"]["duration_seconds"]; per = duration / scene_count
            project["scenes"] = [{"id": f"scene-{i:02d}", "duration_seconds": per, "script": f"Show the product benefit for {project['audience']}. Demonstrate one concrete proof point.", "prompt": f"UGC scene {i}: {project['creator']['name']} presents {project['product']} in {project['format']['genre']} style, consistent identity, natural lighting, no text artifacts.", "status": "PLANNED"} for i in range(1, scene_count + 1)]
            project["status"] = "REVIEW REQUIRED"; project["updated_at"] = _now(); data["revision"] += 1; _atomic_json(self.path, data)
        return dict(project)

    def request_provider(self, project_id: str, capability: str, scene_id: str) -> dict[str, Any]:
        with self._lock:
            data = self._read(); project = self._required(data, project_id); item = self.registry.snapshot()["capabilities"].get(_identifier(capability, "capability"))
            if not item or item["status"] != "approved": project["status"] = "WAITING FOR PROVIDER"; project["updated_at"] = _now(); data["revision"] += 1; _atomic_json(self.path, data); return {"status": "WAITING FOR PROVIDER", "provider": capability, "approved": False}
            if not any(scene["id"] == scene_id for scene in project["scenes"]): raise ValueError("unknown scene")
            project["status"] = "GENERATING"; project["updated_at"] = _now(); data["revision"] += 1; _atomic_json(self.path, data); return {"status": "GENERATING", "provider": capability, "approved": True}

    def record_asset(self, project_id: str, scene_id: str, path: str, provider: str, *, status: str = "GENERATED", evidence: EvidenceReceipt | None = None) -> dict[str, Any]:
        with self._lock:
            data = self._read(); project = self._required(data, project_id)
            if not any(scene["id"] == scene_id for scene in project["scenes"]): raise ValueError("unknown scene")
            if status not in {"GENERATED", "FAILED", "SELECTED"}: raise ValueError("asset status is invalid")
            asset = {"scene_id": scene_id, "path": _text(path, "asset path", 1000), "provider": _text(provider, "provider", 120), "status": status, "recorded_at": _now()}
            if evidence: project["evidence"].append(evidence.__dict__)
            project["assets"].append(asset); project["status"] = "VERIFYING" if status == "GENERATED" else "BLOCKED"; project["updated_at"] = _now(); data["revision"] += 1; _atomic_json(self.path, data)
        return dict(asset)

    def _required(self, data, project_id):
        project = data["projects"].get(_identifier(project_id, "project id"))
        if not project: raise KeyError("UGC project not found")
        return project

    def get(self, project_id: str) -> dict[str, Any]:
        return dict(self._required(self._read(), project_id))
