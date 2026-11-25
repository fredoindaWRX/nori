"""Small atomic checkpoint store for restart-safe Nori state."""
from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import Any


def save_checkpoint(state: dict[str, Any], path: Path) -> Path:
    payload = json.dumps(state, sort_keys=True, ensure_ascii=False).encode("utf-8")
    record = {"schema": "nori.checkpoint.v1", "sha256": hashlib.sha256(payload).hexdigest(), "state": state}
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(record, indent=2, ensure_ascii=False), encoding="utf-8")
    temporary.replace(path)
    return path


def load_checkpoint(path: Path) -> dict[str, Any] | None:
    try:
        record = json.loads(Path(path).read_text(encoding="utf-8"))
        state = record["state"]
        payload = json.dumps(state, sort_keys=True, ensure_ascii=False).encode("utf-8")
        if record.get("schema") != "nori.checkpoint.v1" or record.get("sha256") != hashlib.sha256(payload).hexdigest():
            return None
        return state if isinstance(state, dict) else None
    except (OSError, ValueError, KeyError, TypeError):
        return None
