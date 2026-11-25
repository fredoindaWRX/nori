"""NORI-owned, local-only camera capability contract.

This module discovers whether an explicitly selected local camera endpoint is
available.  It does not open the camera, acquire frames, use a remote service,
or choose a camera silently.  Capture and face encoding are separate adapters.
"""
from __future__ import annotations

from dataclasses import dataclass
import os
from pathlib import Path
import sys
from typing import Mapping


@dataclass(frozen=True)
class CameraCapability:
    state: str
    platform: str
    endpoint: str | None
    capture_permitted: bool
    reason: str

    def as_dict(self) -> dict[str, object]:
        return {"schema": "nori.camera-capability.v1", "state": self.state,
                "platform": self.platform, "endpoint": self.endpoint,
                "capture_permitted": self.capture_permitted, "reason": self.reason}


def inspect(environ: Mapping[str, str] | None = None, platform: str | None = None) -> CameraCapability:
    """Report a configured local camera endpoint without activating it.

    `NORI_CAMERA_ENDPOINT` must be set by owner enrollment or a device adapter.
    On Linux a configured `/dev/video*` endpoint must exist.  Windows adapters
    register a local device identifier during enrollment; no device enumeration
    is performed in this policy process.
    """
    env = os.environ if environ is None else environ
    name = sys.platform if platform is None else platform
    endpoint = str(env.get("NORI_CAMERA_ENDPOINT", "")).strip() or None
    if not endpoint:
        return CameraCapability("camera_unconfigured", name, None, False, "owner_setup_required")
    if name.startswith("linux") and endpoint.startswith("/dev/") and not Path(endpoint).exists():
        return CameraCapability("camera_unavailable", name, endpoint, False, "endpoint_missing")
    return CameraCapability("camera_ready", name, endpoint, False, "capture_requires_explicit_session")
