import json
from pathlib import Path

import pytest

from nori.shared.control_plane.ugc_factory import UGCFactory
from nori.shared.control_plane.v2 import CapabilityRegistry, EvidenceReceipt


def test_ugc_factory_creates_reviewable_scene_plan(tmp_path):
    registry = CapabilityRegistry(tmp_path / "capabilities.json")
    factory = UGCFactory(tmp_path / "ugc", registry)
    project = factory.create("Foldable Lamp", "Save 30% today", "Apartment renters", "lamp demo", creator={"name": "Mara", "identity": "consistent presenter"}, duration_seconds=12)
    planned = factory.plan(project["id"], scene_count=3)
    assert planned["status"] == "REVIEW REQUIRED"
    assert [scene["id"] for scene in planned["scenes"]] == ["scene-01", "scene-02", "scene-03"]
    assert all(scene["script"] and scene["prompt"] for scene in planned["scenes"])


def test_candidate_provider_waits_without_external_call(tmp_path):
    registry = CapabilityRegistry(tmp_path / "capabilities.json")
    registry.register("higgsfield", "connector", "Generate video", risk="high", external=True, status="candidate")
    factory = UGCFactory(tmp_path / "ugc", registry)
    project = factory.create("Lamp", "Offer", "Renters", "Lamp", creator={"name": "Mara"})
    factory.plan(project["id"])
    result = factory.request_provider(project["id"], "higgsfield", "scene-01")
    assert result == {"status": "WAITING FOR PROVIDER", "provider": "higgsfield", "approved": False}


def test_asset_provenance_and_failure_are_recorded(tmp_path):
    registry = CapabilityRegistry(tmp_path / "capabilities.json")
    factory = UGCFactory(tmp_path / "ugc", registry)
    project = factory.create("Lamp", "Offer", "Renters", "Lamp", creator={"name": "Mara"})
    factory.plan(project["id"])
    receipt = EvidenceReceipt.create("execution", "scene-01", b"generated")
    asset = factory.record_asset(project["id"], "scene-01", "assets/scene-01.mp4", "local-fake", evidence=receipt)
    failed = factory.record_asset(project["id"], "scene-01", "assets/scene-02.mp4", "local-fake", status="FAILED")
    assert asset["status"] == "GENERATED" and failed["status"] == "FAILED"
    assert factory.get(project["id"])["status"] == "BLOCKED"
    assert factory.get(project["id"])["evidence"][0]["kind"] == "execution"


def test_invalid_format_is_rejected(tmp_path):
    factory = UGCFactory(tmp_path / "ugc", CapabilityRegistry(tmp_path / "capabilities.json"))
    with pytest.raises(ValueError):
        factory.create("Lamp", "Offer", "Renters", "Lamp", creator={"name": "Mara"}, aspect_ratio="21:9")
