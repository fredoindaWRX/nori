"""Path admission shared by typed workspace tools; never traverse agent links."""
from pathlib import Path, PureWindowsPath
import stat

from security.hard_floor import HardFloorViolation, assert_file_allowed


def reject_link(path: Path) -> None:
    try:
        info = path.lstat()
    except FileNotFoundError:
        return
    # Windows junctions and other reparse points can redirect I/O just as a
    # symbolic link can. Inspect local metadata before any target resolution.
    if stat.S_ISLNK(info.st_mode) or getattr(info, "st_file_attributes", 0) & 0x400:
        raise HardFloorViolation("hard_floor_workspace_link_not_allowed")


def workspace_path(root: Path, value: object, *, operation: str = "read") -> Path:
    if not isinstance(value, str) or not value or len(value) > 240:
        raise ValueError("workspace path is invalid")
    windows = PureWindowsPath(value)
    if (windows.drive or windows.root or Path(value).is_absolute() or ":" in value
            or "\x00" in value or ".." in windows.parts):
        # Reject UNC paths before resolve/stat: those calls can perform SMB I/O.
        raise ValueError("workspace path escapes root or names a device/stream")
    requested = root
    for part in windows.parts:
        requested = requested / part
        reject_link(requested)
    if requested == root:
        raise ValueError("workspace path escapes root")
    resolved = assert_file_allowed(requested, operation=operation)
    if root not in resolved.parents:
        raise HardFloorViolation("hard_floor_workspace_path_escape")
    return resolved
