"""Emit an honest machine-readable readiness report for the twelve Knights."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
import sys

if __package__ in (None, ""):
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from orchestration.knight_registry import KnightRegistry


DEFAULT_ROSTER = Path(__file__).with_name("knights.json")


def build_report(roster: Path = DEFAULT_ROSTER) -> dict:
    registry = KnightRegistry(roster)
    workers = list(registry.readiness())
    native = sum(1 for worker in workers if worker["activatable"])
    service_source = Path(__file__).with_name("knight_service.py")
    return {
        "schema": "nori.knight-readiness.v1",
        "roster": registry.name,
        "version": registry.version,
        "total": len(workers),
        "native": native,
        "remaining": len(workers) - native,
        # Registration and unit coverage prove a usable worker foundation, not
        # a release-ready Council. Image startup and cross-edition evidence are
        # separate requirements and are not present until a release verifier
        # records them.
        "all_foundations_active": native == len(workers),
        "round_table_service": {
            "implemented": service_source.is_file(),
            # Source code and unit tests do not prove that a host is running on
            # this machine or included in a released image.
            "deployed": False,
            "reason": "requires image staging, service configuration, and a live health check",
        },
        "all_functional": False,
        "release_ready": False,
        "workers": workers,
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--roster", type=Path, default=DEFAULT_ROSTER)
    parser.add_argument("--output", type=Path)
    parser.add_argument("--require-all-native", action="store_true")
    args = parser.parse_args()
    report = build_report(args.roster)
    rendered = json.dumps(report, indent=2) + "\n"
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(rendered, encoding="utf-8")
    else:
        print(rendered, end="")
    return 1 if args.require_all_native and not report["release_ready"] else 0


if __name__ == "__main__":
    raise SystemExit(main())
