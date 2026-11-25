"""NORI-owned local face-identity decision policy.

Camera encoders provide normalized feature vectors to this policy; the policy
contains no remote API client, raw-image storage, or vendor-specific SDK.
"""
from __future__ import annotations

from dataclasses import dataclass
import json
import math
from pathlib import Path
from typing import Any, Iterable


@dataclass(frozen=True)
class FaceDecision:
    state: str
    owner_present: bool
    similarity: float | None
    reason: str

    def as_dict(self) -> dict[str, Any]:
        return {"schema": "nori.face-identity.decision.v1", "state": self.state,
                "owner_present": self.owner_present, "similarity": self.similarity,
                "reason": self.reason}


def load_profile(path: Path) -> dict[str, Any]:
    """Load a bounded local profile without accepting biometric image data."""
    if not path.is_file() or path.stat().st_size > 64 * 1024:
        raise ValueError("face_profile_unavailable")
    try:
        profile = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise ValueError("face_profile_invalid") from exc
    if not isinstance(profile, dict) or profile.get("schema") != "nori.face-profile.v1":
        raise ValueError("face_profile_schema_invalid")
    if profile.get("raw_images_retained") is not False:
        raise ValueError("face_profile_raw_image_retention_not_allowed")
    return profile


def profile_ready(profile: dict[str, Any], camera_available: bool) -> bool:
    if not camera_available or profile.get("calibrated") is not True:
        return False
    thresholds = profile.get("thresholds", {})
    try:
        low, high = float(thresholds["reject_below"]), float(thresholds["accept_at_or_above"])
        return math.isfinite(low) and math.isfinite(high) and -1 <= low < high <= 1
    except (KeyError, TypeError, ValueError):
        return False


def similarity(owner: Iterable[float], candidate: Iterable[float]) -> float:
    left, right = tuple(float(v) for v in owner), tuple(float(v) for v in candidate)
    if not left or len(left) != len(right):
        raise ValueError("face_embedding_shape_invalid")
    numerator = sum(a * b for a, b in zip(left, right))
    denominator = math.sqrt(sum(v * v for v in left) * sum(v * v for v in right))
    if not math.isfinite(numerator) or denominator <= 0:
        raise ValueError("face_embedding_invalid")
    return max(-1.0, min(1.0, numerator / denominator))


def decide(profile: dict[str, Any], camera_available: bool,
           owner_embedding: Iterable[float] | None,
           candidate_embedding: Iterable[float] | None) -> FaceDecision:
    if not camera_available:
        return FaceDecision("camera_unavailable", False, None, "camera_not_available")
    if not profile_ready(profile, camera_available):
        return FaceDecision("not_calibrated", False, None, "calibration_required")
    if owner_embedding is None or candidate_embedding is None:
        return FaceDecision("face_unavailable", False, None, "face_not_detected")
    score = similarity(owner_embedding, candidate_embedding)
    threshold = profile["thresholds"]
    if score >= float(threshold["accept_at_or_above"]):
        return FaceDecision("owner_present", True, score, "accepted")
    if score < float(threshold["reject_below"]):
        return FaceDecision("not_owner", False, score, "rejected")
    return FaceDecision("ambiguous", False, score, "repeat_or_enrolled_device")
