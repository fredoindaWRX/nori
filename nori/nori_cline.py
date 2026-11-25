"""Nori-owned command line bridge for bounded Cline work orders."""
from __future__ import annotations

import argparse
import asyncio
import json
from pathlib import Path

from nori.development_workers.base import WorkOrder
from nori.development_workers.cline_adapter import ClineAdapter
from nori.shared.control_plane.autonomy import AutonomousWorkerController
from nori.shared.control_plane.v2 import ActionIntent, CapabilityRegistry


def _paths(values: list[str], root: Path) -> list[Path]:
    return [(root / value).resolve() if not Path(value).is_absolute() else Path(value).resolve()
            for value in values]


async def _run(args: argparse.Namespace) -> int:
    root = Path(args.root).resolve()
    intent = ActionIntent(
        action=args.goal,
        outward_facing=args.outward_facing,
        financial=args.financial,
        destructive=args.destructive,
    )
    allowed = _paths(args.allow, root)
    order = WorkOrder(
        task_id=args.task_id,
        original_goal=args.goal,
        bounded_scope=allowed,
        allowed_files=allowed,
        current_state=args.current_state,
        next_action=args.next_action,
        acceptance_criteria=args.acceptance,
        context_files=_paths(args.context, root),
        timeout_seconds=args.timeout,
    )
    # Reuse the owner's normal Cline authentication. File access remains
    # bounded independently by the adapter's workspace and allow-list checks.
    adapter = ClineAdapter(root)
    if args.health:
        status = await adapter.get_status()
        print(json.dumps({"worker": status.worker_id, "health": status.health.name.lower()}, indent=2))
        return 0 if status.health.name == "HEALTHY" else 1
    registry = CapabilityRegistry(Path(args.v2_root).resolve())
    run = await AutonomousWorkerController(registry, adapter).run(order, intent=intent)
    print(json.dumps({
        "outcome": run.outcome,
        "worker": run.worker,
        "error_type": run.error_type,
        "changed_files": list(run.changed_files),
        "evidence": run.evidence,
        "detail": run.detail,
    }, indent=2, ensure_ascii=False))
    return 0 if run.outcome == "completed" else 1


def main() -> int:
    parser = argparse.ArgumentParser(description="Dispatch a bounded autonomous task to Cline")
    parser.add_argument("goal", nargs="?", default="health check")
    parser.add_argument("--root", default=str(Path.cwd()))
    parser.add_argument("--v2-root", default=str(Path(__file__).resolve().parent / "runtime-data" / "v2" / "capabilities.json"))
    parser.add_argument("--task-id", default="cline-task")
    parser.add_argument("--allow", action="append", default=[])
    parser.add_argument("--context", action="append", default=[])
    parser.add_argument("--current-state", default="Owner-authorized Nori workspace")
    parser.add_argument("--next-action", default="Complete the bounded work order")
    parser.add_argument("--acceptance", default="Relevant verification passes with concrete evidence")
    parser.add_argument("--timeout", type=int, default=1800)
    parser.add_argument("--health", action="store_true")
    parser.add_argument("--outward-facing", action="store_true")
    parser.add_argument("--financial", action="store_true")
    parser.add_argument("--destructive", action="store_true")
    return asyncio.run(_run(parser.parse_args()))


if __name__ == "__main__":
    raise SystemExit(main())
