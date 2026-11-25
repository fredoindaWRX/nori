"""Fail-closed preflight for an explicitly assembled NORI clean installer.

This check inspects the staged filesystem before an image is built.  It does
not certify a raw disk image, boot hardware, signed release, or first boot;
those require their own release acceptance evidence.
"""
from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import stat
from typing import Any

from tools.usb_capacity import absolute_without_links, is_link


REQUIRED_UNCLAIMED_PROFILE = {
    "schema": "nori.operator-profile.v1",
    "principal_id": "owner.unclaimed",
    "callsign": "Unclaimed",
    "display_name": "Unclaimed owner",
    "title": "Pending activation",
    "owner_number": 1,
}
FORBIDDEN_NAMES = frozenset({
    "owner-enrolled", "owner.key", "owner.pem", "operator-profile.private.json",
    "conversation.db", "memory.db", "pairing-state.json", "session-token.json",
    "council-token", "round-table.token", "round-table.env",
})
PRIVATE_TREES = ('var/lib/nori', 'root/.ssh', 'root/.ollama', 'home',
                 'runtime-data', 'secrets')


def inspect_stage(stage: Path) -> dict[str, Any]:
    """Return a deterministic preflight report for one real staged root."""
    stage = absolute_without_links(stage)
    issues: list[dict[str, str]] = []
    try:
        for parent in (*reversed(stage.parents), stage):
            if is_link(parent.lstat()):
                raise ValueError('linked_stage')
        if not stage.is_dir():
            raise ValueError('missing_stage')
    except (OSError, ValueError) as error:
        return {"schema": "nori.clean-install-preflight.v1", "status": "invalid",
                "stage": str(stage), "issues": [{"kind": type(error).__name__, "path": str(stage)}]}
    files = set()
    pending = [stage]
    while pending:
        current = pending.pop()
        relative = current.relative_to(stage).as_posix()
        try:
            info = current.lstat()
            if is_link(info):
                issues.append({'kind': 'uninspected_link', 'path': relative})
            elif stat.S_ISDIR(info.st_mode):
                with os.scandir(current) as entries:
                    pending.extend(Path(entry.path) for entry in entries)
            elif stat.S_ISREG(info.st_mode):
                files.add(relative)
                if (current.name.lower() in FORBIDDEN_NAMES or
                        any(relative == prefix or relative.startswith(prefix + '/')
                            for prefix in PRIVATE_TREES)):
                    issues.append({'kind': 'persisted_owner_state', 'path': relative})
            else:
                issues.append({'kind': 'uninspected_special_file', 'path': relative})
        except OSError:
            issues.append({'kind': 'unreadable_stage_entry', 'path': relative})
    profile = stage / "etc" / "nori" / "operator-profile.json"
    if 'etc/nori/operator-profile.json' not in files:
        issues.append({"kind": "missing_unclaimed_profile", "path": str(profile)})
    else:
        try:
            if profile.stat().st_size > 16384:
                raise ValueError('oversized_profile')
            candidate = json.loads(profile.read_text(encoding="utf-8"))
        except (OSError, ValueError, UnicodeError):
            candidate = None
        if candidate != REQUIRED_UNCLAIMED_PROFILE:
            issues.append({"kind": "owner_profile_not_unclaimed", "path": str(profile)})
    issues.sort(key=lambda item: (item['path'], item['kind']))
    return {"schema": "nori.clean-install-preflight.v1",
            "status": "clean" if not issues else "blocked",
            "stage": str(stage), "issues": issues,
            "scope": "known-state checks on an immutable regular-file runtime stage only; not a complete secret scanner or mounted-root/boot/signature acceptance"}


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--stage", type=Path, required=True)
    args = parser.parse_args(argv)
    report = inspect_stage(args.stage)
    print(json.dumps(report, indent=2))
    return 0 if report["status"] == "clean" else 2


if __name__ == "__main__":
    raise SystemExit(main())
