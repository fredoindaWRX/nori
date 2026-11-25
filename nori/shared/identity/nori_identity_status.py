"""NORI local owner-presence runtime status command.

This command intentionally exposes capability and enrollment state only.  It
does not acquire camera frames, print biometric vectors, or contact a service.
"""
from __future__ import annotations

import json

from nori_face_identity import decide as decide_face
from owner_presence import decide as decide_presence


def status() -> dict[str, object]:
    face = decide_face({}, False, None, None).as_dict()
    voice = {
        "schema": "nori.voice-identity.decision.v1",
        "state": "audio_unavailable",
        "owner_verified": False,
        "similarity": None,
        "reason": "microphone_not_opened",
    }
    presence = decide_presence(voice, face)
    return {
        "schema": "nori.owner-presence.status.v1",
        "local_only": True,
        "camera_capture_active": False,
        "raw_biometric_data_exposed": False,
        "voice": voice,
        "face": face,
        "presence": presence,
    }


if __name__ == "__main__":
    print(json.dumps(status(), separators=(",", ":"), sort_keys=True))
