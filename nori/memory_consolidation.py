"""Nightly deterministic memory consolidation for the local NORI desktop."""
from __future__ import annotations

import argparse
import json
import importlib.util
from pathlib import Path

ROOT = Path(__file__).resolve().parent


def _load_symbol(path: Path, name: str, symbol: str):
    """Load shared runtime modules without colliding with legacy ``memory.py``."""
    spec = importlib.util.spec_from_file_location(name, path)
    if spec is None or spec.loader is None:
        raise ImportError(f"Unable to load shared runtime module: {path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return getattr(module, symbol)


MemoryStore = _load_symbol(ROOT / "shared" / "memory" / "nori_memory.py", "_nori_shared_memory", "MemoryStore")
Policy = _load_symbol(ROOT / "shared" / "permissions" / "nori_policy.py", "_nori_shared_policy", "Policy")


# Preserve the legacy active-learning contract while exposing the newer
# Merovingian store workflow below.  Both paths are intentionally available:
# old jobs consolidate the knowledge file, while the runtime job uses ``run``
# for the policy-backed memory store.
_legacy_spec = importlib.util.spec_from_file_location(
    "_nori_legacy_memory_consolidation", ROOT.parent / "memory_consolidation.py"
)
if _legacy_spec is None or _legacy_spec.loader is None:
    raise ImportError("Unable to load legacy memory consolidation module")
_legacy_memory = importlib.util.module_from_spec(_legacy_spec)
_legacy_spec.loader.exec_module(_legacy_memory)
consolidate = _legacy_memory.consolidate


ACTIVE_STATES = {"queued", "planning", "running", "cancelling", "verifying"}


def active_work(store_root: Path) -> list[str]:
    active = []
    for path in store_root.glob("*.json"):
        try:
            state = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            continue
        if state.get("status") in ACTIVE_STATES:
            active.append(str(state.get("task_id") or path.stem))
    return active


def run(data_root: Path, *, apply: bool = True) -> dict:
    work = active_work(data_root / "work-sessions")
    if work:
        return {"status": "skipped", "reason": "knights_active", "tasks": work}
    memory_root = data_root / "merovingian" / "memory"
    snapshots = data_root / "merovingian" / "consolidated"
    archives = data_root / "merovingian" / "archives"
    audit = data_root / "merovingian" / "audit.jsonl"
    store = MemoryStore(memory_root, Policy(["memory_read", "memory_write"]), audit)
    results = []
    for journal in sorted(memory_root.glob("*.jsonl")):
        results.append(store.consolidate(journal.stem, snapshots / f"{journal.stem}.json",
                                         archives, apply=apply))
    index = {
        "schema": "nori.memory-consolidation.v1",
        "status": "completed",
        "applied": apply,
        "scopes": [{key: item[key] for key in
                    ("scope", "created_at", "source_entries", "active_entries", "exact_duplicates")}
                   for item in results],
    }
    snapshots.mkdir(parents=True, exist_ok=True)
    destination = snapshots / "state-snapshot.json"
    temporary = destination.with_suffix(".json.tmp")
    temporary.write_text(json.dumps(index, ensure_ascii=False, indent=2), encoding="utf-8")
    temporary.replace(destination)
    return index


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--data-root", type=Path, default=ROOT / "runtime-data")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    print(json.dumps(run(args.data_root.resolve(), apply=not args.dry_run), indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
