"""Validated operator metadata shared by NORI surfaces.

The profile supplies human-readable identity and a stable principal identifier.
It never grants authority by itself; Nexus certificate identity and the active
permission policy remain authoritative.
"""

from __future__ import annotations

import json
from pathlib import Path
import re
from typing import Any


SCHEMA = "nori.operator-profile.v1"
_ID = re.compile(r"[a-z0-9][a-z0-9._-]{2,63}")
_CALLSIGN = re.compile(r"[A-Za-z0-9][A-Za-z0-9 ._-]{0,31}")


def validate(profile: Any) -> dict[str, Any]:
    if not isinstance(profile, dict):
        raise ValueError("operator profile must be an object")
    expected = {"schema", "principal_id", "callsign", "display_name", "title", "owner_number"}
    if set(profile) != expected:
        raise ValueError("operator profile fields are invalid")
    if profile["schema"] != SCHEMA:
        raise ValueError("operator profile schema is unsupported")
    if not isinstance(profile["principal_id"], str) or not _ID.fullmatch(profile["principal_id"]):
        raise ValueError("principal_id is invalid")
    for field in ("callsign", "display_name", "title"):
        value = profile[field]
        if not isinstance(value, str) or not _CALLSIGN.fullmatch(value):
            raise ValueError(f"{field} is invalid")
    owner_number = profile["owner_number"]
    if not isinstance(owner_number, int) or isinstance(owner_number, bool) or not 1 <= owner_number <= 999999:
        raise ValueError("owner_number is invalid")
    return dict(profile)


def load(path: str | Path) -> dict[str, Any]:
    return validate(json.loads(Path(path).read_text(encoding="utf-8")))


def operational_label(profile: dict[str, Any]) -> str:
    profile = validate(profile)
    return f"{profile['callsign']} · {profile['title']} · Owner {profile['owner_number']:03d}"

