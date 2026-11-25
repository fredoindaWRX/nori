"""Portable-bundle inventory and validation (read-only)."""
from __future__ import annotations

from pathlib import Path

REQUIRED = ("nori", "launcher.py", "speech.py", "voice.py")


def validate(root: Path = Path(r"C:\Nori")) -> dict[str, object]:
    root = Path(root)
    missing = [item for item in REQUIRED if not (root / item).exists()]
    return {"schema": "nori.portable.manifest.v1", "root": str(root), "missing": missing, "ready": not missing}
