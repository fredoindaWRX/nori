"""Read-only health probe for the local West Line FXServer runtime."""
from __future__ import annotations

import json
import subprocess
from pathlib import Path


def latest_log(log_dir: Path = Path(r"C:\ViceNights\server-data\logs")) -> Path | None:
    files = sorted(log_dir.glob("cfx-server-*.log"), key=lambda p: p.stat().st_mtime, reverse=True)
    return files[0] if files else None


def gameplay_hotfix_status(
    verifier: Path = Path(r"C:\ViceNights\tools\Verify-WestLineGameplayHotfixes.ps1"),
) -> dict[str, object]:
    return _powershell_json_status(verifier, "gameplay verifier")


def admin_surface_status(
    verifier: Path = Path(r"C:\ViceNights\tools\Verify-WestLineAdminSurface.ps1"),
) -> dict[str, object]:
    return _powershell_json_status(verifier, "admin surface verifier")


def _powershell_json_status(verifier: Path, label: str) -> dict[str, object]:
    if not verifier.exists():
        return {"success": False, "reason": f"{label} missing", "path": str(verifier)}
    try:
        process = subprocess.run(
            [
                "powershell.exe",
                "-NoProfile",
                "-NonInteractive",
                "-ExecutionPolicy",
                "Bypass",
                "-File",
                str(verifier),
            ],
            capture_output=True,
            text=True,
            timeout=20,
            creationflags=subprocess.CREATE_NO_WINDOW,
        )
    except Exception as exc:
        return {"success": False, "reason": str(exc), "path": str(verifier)}
    if process.returncode != 0:
        return {
            "success": False,
            "reason": process.stderr.strip() or process.stdout.strip() or "verifier failed",
            "path": str(verifier),
        }
    try:
        data = json.loads(process.stdout)
    except json.JSONDecodeError as exc:
        return {"success": False, "reason": f"verifier returned invalid JSON: {exc}", "path": str(verifier)}
    data["path"] = str(verifier)
    data.setdefault("success", data.get("status") in {"READY", "GAME_ONLY"})
    return data


def probe(log_dir: Path = Path(r"C:\ViceNights\server-data\logs")) -> dict[str, object]:
    path = latest_log(log_dir)
    if path is None:
        return {"status": "UNAVAILABLE", "reason": "no FXServer log found"}
    text = path.read_text(encoding="utf-8", errors="replace")
    healthy = "CORE STATUS: PASS" in text and "health=PASS" in text
    refreshed = "refreshed 113/113 resource(s)" in text or "refreshed" in text
    clean_boot = "all tracked resources started" in text
    gameplay = gameplay_hotfix_status()
    admin = admin_surface_status()
    if admin.get("status") == "DOWN" and "listeners" in admin:
        admin.setdefault("availability", "no_game_or_txadmin_listener")
        # A running game with an unavailable txAdmin surface is still
        # playable.  Keep the distinction explicit for operators and callers
        # instead of collapsing it into a failed runtime.
        if admin.get("gameListening") is True or admin.get("game_listening") is True:
            admin["status"] = "GAME_ONLY"
            admin["success"] = True
    elif admin.get("success") is False:
        admin.setdefault("availability", "verifier_unavailable_or_failed")
    gameplay_ok = gameplay.get("success") is True
    return {
        "status": "HEALTHY" if healthy and (refreshed or clean_boot) and gameplay_ok else "DEGRADED",
        "log": str(path),
        "core_pass": healthy,
        "resource_refresh_seen": refreshed or clean_boot,
        "gameplay_hotfixes": gameplay,
        "admin_surface": admin,
    }
