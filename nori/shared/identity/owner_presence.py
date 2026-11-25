"""Fuse local NORI voice and face decisions without weakening owner recovery."""
from __future__ import annotations

from typing import Any


def decide(voice: dict[str, Any], face: dict[str, Any]) -> dict[str, Any]:
    """Return a UI/session hint; device-key authorization remains separate.

    A positive voice match starts the normal hands-free owner experience. A
    positive face match strengthens confidence but cannot turn a non-owner voice
    into an owner command. Missing camera/audio is normal and never presented as
    a denial of device-key access.
    """
    voice_state = str(voice.get("state", "audio_unavailable"))
    face_state = str(face.get("state", "camera_unavailable"))
    voice_owner = voice_state == "owner_verified" and voice.get("owner_verified") is True
    face_owner = face_state == "owner_present" and face.get("owner_present") is True
    if voice_owner and face_owner:
        state, confidence = "owner_present_multimodal", "high"
    elif voice_owner:
        state, confidence = "owner_present_voice", "normal"
    elif voice_state == "not_owner":
        state, confidence = "guest_or_unverified", "none"
    elif face_owner:
        state, confidence = "owner_present_needs_voice_or_device", "presence_only"
    elif voice_state == "ambiguous" or face_state == "ambiguous":
        state, confidence = "identity_ambiguous", "low"
    else:
        state, confidence = "identity_unavailable", "none"
    return {"schema": "nori.owner-presence.v1", "state": state,
            "confidence": confidence, "voice_state": voice_state,
            "face_state": face_state,
            "device_key_required_for_recovery": True}
