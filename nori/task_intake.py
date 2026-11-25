"""Safe bridge from N.O.R.I.'s signed chat queue to local work packets.

This module does not run code changes or deploy anything.  It is deliberately
small enough to run at desktop startup or from a local worker, and leaves a
plain audit status the UI can read without inventing completion.
"""

from __future__ import annotations

import json
import time
from pathlib import Path
from typing import Any

from nori.self_development import RUNS_DIR, TASK_FILE, stage_queued_local_tasks
from nori.workspace_operator import DEFAULT_ROOT


STATUS_FILE = DEFAULT_ROOT / "data" / "nori" / "task_intake_status.json"


def stage_once(
    *,
    task_file: Path = TASK_FILE,
    runs_dir: Path = RUNS_DIR,
    status_file: Path = STATUS_FILE,
) -> dict[str, Any]:
    """Stage all new local queue entries and atomically report exactly what happened."""
    now = time.time()
    try:
        staged = stage_queued_local_tasks(task_file=task_file, runs_dir=runs_dir)
        result: dict[str, Any] = {
            "schema": "nori.local_task_intake_status.v1",
            "checked_at": now,
            "result": "PASS",
            "staged_task_ids": [str(item["task_id"]) for item in staged],
            "staged_count": len(staged),
            "execution": "not_started",
            "live_changes_allowed": False,
        }
    except Exception as exc:
        result = {
            "schema": "nori.local_task_intake_status.v1",
            "checked_at": now,
            "result": "ERROR",
            "staged_task_ids": [],
            "staged_count": 0,
            "execution": "not_started",
            "live_changes_allowed": False,
            "error": type(exc).__name__,
        }
    target = Path(status_file)
    target.parent.mkdir(parents=True, exist_ok=True)
    temporary = target.with_suffix(target.suffix + ".tmp")
    temporary.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    temporary.replace(target)
    return result


def main() -> int:
    """Command-line entrypoint for the bounded local intake scheduled task."""
    result = stage_once()
    print(json.dumps(result, ensure_ascii=False, sort_keys=True))
    return 0 if result.get("result") == "PASS" else 1


if __name__ == "__main__":
    raise SystemExit(main())
