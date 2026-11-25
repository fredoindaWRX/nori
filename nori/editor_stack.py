"""Truthful, local-only availability for the optional desktop editor stack.

Discovery is deliberately read-only.  Opening a workspace is a separate,
explicit owner action and is never performed as part of capability reporting.
"""
from __future__ import annotations

from pathlib import Path
from typing import Any, Callable, Iterable
import subprocess


SCHEMA = "nori.editor_stack.v1"
OWNER_OPEN_ACTION = "open_nori_workspace_in_vscode"
DEFAULT_WORKSPACE = Path(r"C:\Nori")
DEFAULT_VSCODE_PATHS = (
    Path(r"C:\Users\Studio\AppData\Local\Programs\Microsoft VS Code\Code.exe"),
    Path(r"C:\Program Files\Microsoft VS Code\Code.exe"),
)
DEFAULT_EXTENSION_ROOTS = (
    Path(r"C:\Users\Studio\.vscode\extensions"),
    Path(r"C:\Users\Studio\.vscode-insiders\extensions"),
)
DEFAULT_CLINE_STORAGE_ROOTS = (
    Path(r"C:\Users\Studio\AppData\Roaming\Code\User\globalStorage"),
    Path(r"C:\Users\Studio\AppData\Roaming\Code - Insiders\User\globalStorage"),
)


def _first_file(paths: Iterable[Path]) -> Path | None:
    return next((path for path in paths if path.is_file()), None)


def _cline_entries(roots: Iterable[Path]) -> list[str]:
    entries: list[str] = []
    for root in roots:
        if not root.is_dir():
            continue
        entries.extend(
            str(child)
            for child in root.iterdir()
            if "cline" in child.name.casefold() or "claude-dev" in child.name.casefold()
        )
    return sorted(entries)


def editor_status(
    *,
    vscode_paths: Iterable[Path] = DEFAULT_VSCODE_PATHS,
    extension_roots: Iterable[Path] = DEFAULT_EXTENSION_ROOTS,
    cline_storage_roots: Iterable[Path] = DEFAULT_CLINE_STORAGE_ROOTS,
) -> dict[str, Any]:
    """Report local installation evidence without opening an editor or reading secrets."""
    executable = _first_file(tuple(Path(path) for path in vscode_paths))
    cline_extensions = _cline_entries(tuple(Path(root) for root in extension_roots))
    cline_storage = _cline_entries(tuple(Path(root) for root in cline_storage_roots))
    vscode = {
        "available": executable is not None,
        "executable": str(executable) if executable else None,
        "file_name": executable.name if executable else None,
    }
    # Product-version inspection is platform-specific and does not affect the
    # availability claim, so this adapter exposes only the discovered file.
    cline_available = bool(cline_extensions or cline_storage)
    return {
        "schema": SCHEMA,
        "status": "available" if executable else "unavailable",
        "discovery": "read_only_local_filesystem",
        "vscode": vscode,
        "cline": {
            "available": cline_available,
            "extension_entries": cline_extensions,
            "storage_entries": cline_storage,
            "configuration_read": False,
        },
        "open_workspace": {
            "available": executable is not None,
            "automatic": False,
            "owner_action_required": OWNER_OPEN_ACTION,
            "workspace": str(DEFAULT_WORKSPACE),
        },
        "limitations": [
            "Availability is local installation evidence, not a successful editor or extension session.",
            "Cline availability is based only on local extension/storage presence; no account, API key, or configuration is read.",
            "Capability reporting never launches VS Code.",
        ],
    }


def open_nori_workspace(
    owner_action: str,
    *,
    workspace: Path = DEFAULT_WORKSPACE,
    status: dict[str, Any] | None = None,
    launcher: Callable[[list[str]], Any] | None = None,
) -> dict[str, Any]:
    """Open the NORI workspace only after the caller supplies the exact owner action."""
    if owner_action != OWNER_OPEN_ACTION:
        return {"opened": False, "reason": "explicit_owner_action_required"}
    workspace = Path(workspace)
    if not workspace.is_dir():
        return {"opened": False, "reason": "workspace_not_found", "workspace": str(workspace)}
    current = status or editor_status()
    executable = current.get("vscode", {}).get("executable")
    if not current.get("vscode", {}).get("available") or not executable:
        return {"opened": False, "reason": "vscode_unavailable"}
    command = [str(executable), str(workspace)]
    if launcher is None:
        subprocess.Popen(command, close_fds=True)
    else:
        launcher(command)
    return {"opened": True, "workspace": str(workspace), "command": command}
