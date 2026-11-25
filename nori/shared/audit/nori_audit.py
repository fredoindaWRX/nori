"""Append-only structured NORI audit events."""
from datetime import datetime, timezone
import json
from pathlib import Path

def record(path: Path, action: str, subject: str, outcome: str = "observed", details=None) -> dict:
    if not action or not subject: raise ValueError("action and subject are required")
    event={"time":datetime.now(timezone.utc).isoformat(),"action":action,"subject":subject,"outcome":outcome,"details":details or {}}
    path.parent.mkdir(parents=True,exist_ok=True)
    with path.open("a",encoding="utf-8") as f: f.write(json.dumps(event,separators=(",",":"))+"\n")
    return event

def read(path: Path):
    if not path.exists(): return []
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]
