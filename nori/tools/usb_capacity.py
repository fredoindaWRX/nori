"""Read-only capacity gate for explicitly selected NORI deployment payloads.

A successful result verifies a byte budget only. It cannot establish that the
selected files form a complete, portable, bootable, or hardware-ready release.
"""
from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import stat
from typing import Any


DEFAULT_PROFILE = Path(__file__).absolute().parents[1] / "config" / "usb-128gb.json"
REPARSE_POINT = getattr(stat, "FILE_ATTRIBUTE_REPARSE_POINT", 0x400)


def validate_profile(profile: dict[str, Any]) -> dict[str, Any]:
    if profile.get("schema") != "nori.usb.capacity-profile.v1":
        raise ValueError("Unsupported capacity profile schema")
    for key in ("media_bytes", "reserve_bytes", "filesystem_overhead_bytes", "allocation_unit_bytes"):
        value = profile.get(key)
        if type(value) is not int or value < 0:
            raise ValueError(f"{key} must be a nonnegative integer")
    unit = profile["allocation_unit_bytes"]
    if unit < 512 or unit > 1048576 or unit & (unit - 1):
        raise ValueError("allocation_unit_bytes must be a power of two from 512 to 1048576")
    if profile["media_bytes"] <= profile["reserve_bytes"] + profile["filesystem_overhead_bytes"]:
        raise ValueError("Media must have a positive payload budget after reserves")
    return profile


def is_link(info: os.stat_result) -> bool:
    return stat.S_ISLNK(info.st_mode) or bool(getattr(info, "st_file_attributes", 0) & REPARSE_POINT)


def absolute_without_links(path: str | Path) -> Path:
    """Normalize spelling without Path.resolve(), which follows links."""
    return Path(os.path.abspath(os.fspath(path)))


def select_payloads(paths: list[str | Path]) -> list[Path]:
    if not paths:
        raise ValueError("Select at least one actual staged payload with --payload")
    selected = [absolute_without_links(path) for path in paths]
    for index, path in enumerate(selected):
        for other in selected[:index]:
            if path == other or path in other.parents or other in path.parents:
                raise ValueError(f"Payload roots overlap: {other} and {path}")
    return selected


def measure_payload(path: Path, allocation_unit: int) -> dict[str, Any]:
    result: dict[str, Any] = {
        "path": str(path), "logical_bytes": 0, "allocated_bytes_estimate": 0,
        "files": 0, "directories": 0, "skipped_links": 0, "errors": [],
    }

    def record_error(current: Path, reason: str) -> None:
        result["errors"].append({"path": str(current), "reason": reason})

    # A direct path into a junction must not bypass the recursive link check.
    for ancestor in reversed(path.parents):
        try:
            info = ancestor.lstat()
        except OSError as error:
            record_error(ancestor, type(error).__name__)
            return result
        if is_link(info):
            result["skipped_links"] += 1
            record_error(ancestor, "reparse_or_symbolic_link_ancestor")
            return result

    pending = [path]
    while pending:
        current = pending.pop()
        try:
            info = current.lstat()
            if is_link(info):
                result["skipped_links"] += 1
                record_error(current, "reparse_or_symbolic_link")
            elif stat.S_ISREG(info.st_mode):
                result["files"] += 1
                result["logical_bytes"] += info.st_size
                # Sparse/compressed files count at logical size: copying them
                # onto a different filesystem may lose their space savings.
                result["allocated_bytes_estimate"] += (
                    (info.st_size + allocation_unit - 1) // allocation_unit * allocation_unit
                )
            elif stat.S_ISDIR(info.st_mode):
                result["directories"] += 1
                with os.scandir(current) as entries:
                    pending.extend(Path(entry.path) for entry in entries)
            else:
                record_error(current, "unsupported_file_type")
        except OSError as error:
            record_error(current, type(error).__name__)
    return result


def check_capacity(paths: list[str | Path], profile: dict[str, Any]) -> dict[str, Any]:
    validate_profile(profile)
    payloads = [measure_payload(path, profile["allocation_unit_bytes"]) for path in select_payloads(paths)]
    logical = sum(item["logical_bytes"] for item in payloads)
    allocated = sum(item["allocated_bytes_estimate"] for item in payloads)
    budget = profile["media_bytes"] - profile["reserve_bytes"] - profile["filesystem_overhead_bytes"]
    complete = all(not item["errors"] for item in payloads)
    fits = complete and allocated <= budget
    return {
        "schema": "nori.usb.capacity-report.v1",
        "scope": "capacity_only; no completeness, dependency, portability, boot, or hardware validation",
        "status": "incomplete" if not complete else "fits_budget" if fits else "exceeds_budget",
        "fits_budget": fits,
        "measurement_complete": complete,
        "media_bytes": profile["media_bytes"],
        "reserve_bytes": profile["reserve_bytes"],
        "filesystem_overhead_bytes": profile["filesystem_overhead_bytes"],
        "allocation_unit_bytes": profile["allocation_unit_bytes"],
        "payload_budget_bytes": budget,
        "logical_bytes": logical,
        "allocated_bytes_estimate": allocated,
        "remaining_payload_bytes": budget - allocated,
        "payloads": payloads,
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--profile", type=Path, default=DEFAULT_PROFILE)
    parser.add_argument("--payload", action="append", required=True, type=Path,
                        help="File or staged directory to measure; repeat for separate payload roots")
    args = parser.parse_args(argv)
    try:
        profile = json.loads(args.profile.read_text(encoding="utf-8"))
        if not isinstance(profile, dict):
            raise ValueError("Capacity profile must be a JSON object")
        report = check_capacity(args.payload, profile)
    except (OSError, ValueError) as error:
        print(json.dumps({"status": "invalid", "fits_budget": False, "error": str(error)}, indent=2))
        return 2
    print(json.dumps(report, indent=2))
    return 0 if report["fits_budget"] else 1 if report["measurement_complete"] else 2


if __name__ == "__main__":
    raise SystemExit(main())
