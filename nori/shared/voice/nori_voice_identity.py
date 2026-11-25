"""NORI-owned local voice-identity policy and profile contract."""
from __future__ import annotations

from dataclasses import dataclass
import json
import math
from pathlib import Path
from typing import Any, Iterable


@dataclass(frozen=True)
class VoiceDecision:
    state: str
    owner_verified: bool
    similarity: float | None
    reason: str

    def as_dict(self) -> dict[str, Any]:
        return {"schema": "nori.voice-identity.decision.v1", "state": self.state,
                "owner_verified": self.owner_verified, "similarity": self.similarity,
                "reason": self.reason}


def load_profile(path: Path) -> dict[str, Any]:
    if not path.is_file() or path.stat().st_size > 64 * 1024:
        raise ValueError("voice_profile_unavailable")
    try:
        profile = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise ValueError("voice_profile_invalid") from error
    if not isinstance(profile, dict):
        raise ValueError("voice_profile_invalid")
    return profile


def profile_status(profile: dict[str, Any]) -> dict[str, Any]:
    thresholds = profile.get("thresholds")
    calibrated = profile.get("calibrated") is True
    try:
        low = float(thresholds["reject_below"])
        high = float(thresholds["accept_at_or_above"])
        valid = math.isfinite(low) and math.isfinite(high) and -1 <= low < high <= 1
    except (KeyError, TypeError, ValueError):
        valid = False
    ready = calibrated and valid
    return {"schema": "nori.voice-identity.profile-status.v1", "ready": ready,
            "calibrated": calibrated, "embedding_dim": profile.get("embedding_dim"),
            "sample_count": profile.get("sample_count"),
            "raw_audio_retained": profile.get("raw_audio_retained") is True,
            "reason": "ready" if ready else "calibration_required"}


def cosine_similarity(owner: Iterable[float], candidate: Iterable[float]) -> float:
    left, right = tuple(float(v) for v in owner), tuple(float(v) for v in candidate)
    if not left or len(left) != len(right):
        raise ValueError("embedding_shape_invalid")
    dot = sum(a * b for a, b in zip(left, right))
    left_norm, right_norm = math.sqrt(sum(v * v for v in left)), math.sqrt(sum(v * v for v in right))
    if not math.isfinite(dot) or left_norm <= 0 or right_norm <= 0:
        raise ValueError("embedding_invalid")
    return max(-1.0, min(1.0, dot / (left_norm * right_norm)))


def decide(profile: dict[str, Any], owner_embedding: Iterable[float] | None,
           candidate_embedding: Iterable[float] | None) -> VoiceDecision:
    status = profile_status(profile)
    if not status["ready"]:
        return VoiceDecision("not_calibrated", False, None, "calibration_required")
    if owner_embedding is None or candidate_embedding is None:
        return VoiceDecision("audio_unavailable", False, None, "embedding_unavailable")
    score = cosine_similarity(owner_embedding, candidate_embedding)
    thresholds = profile["thresholds"]
    if score >= float(thresholds["accept_at_or_above"]):
        return VoiceDecision("owner_verified", True, score, "accepted")
    if score < float(thresholds["reject_below"]):
        return VoiceDecision("not_owner", False, score, "rejected")
    return VoiceDecision("ambiguous", False, score, "repeat_or_enrolled_device")
