"""Validate NORI's installed-system first-boot owner-security contract."""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any


REQUIRED = frozenset({"password_or_pin", "device_key"})
OPTIONAL = frozenset({"fingerprint", "face_presence", "owner_voice"})
CONTACTS = frozenset({"linked_email"})
RECOVERY = frozenset({"offline_recovery_key"})


def load(path: Path) -> dict[str, Any]:
    if not path.is_file() or path.stat().st_size > 16 * 1024:
        raise ValueError("first_boot_security_unavailable")
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise ValueError("first_boot_security_invalid") from exc
    expected = {"schema", "state", "required", "optional_when_supported",
                "account_contacts_supported", "recovery_required",
                "linked_email_required", "linked_email_grants_owner_authority",
                "recovery_contact_grants_owner_authority",
                "biometrics_local_only", "biometrics_stored_in_installer",
                "allow_owner_session_before_required_enrollment"}
    if not isinstance(value, dict) or set(value) != expected:
        raise ValueError("first_boot_security_invalid")
    if value["schema"] != "nori.first-boot-security.v1" or value["state"] != "pending":
        raise ValueError("first_boot_security_invalid")
    if set(value["required"]) != REQUIRED or set(value["optional_when_supported"]) != OPTIONAL:
        raise ValueError("first_boot_security_invalid")
    if (set(value["account_contacts_supported"]) != CONTACTS or
            set(value["recovery_required"]) != RECOVERY or
            value["linked_email_required"] is not False or
            value["linked_email_grants_owner_authority"] is not False or
            value["recovery_contact_grants_owner_authority"] is not False):
        raise ValueError("first_boot_security_invalid")
    if (value["biometrics_local_only"] is not True or
            value["biometrics_stored_in_installer"] is not False or
            value["allow_owner_session_before_required_enrollment"] is not False):
        raise ValueError("first_boot_security_invalid")
    return value


def completion(required_completed: set[str], device_capabilities: set[str],
               recovery_completed: set[str] | None = None) -> dict[str, Any]:
    missing = sorted((REQUIRED - set(required_completed)) |
                     (RECOVERY - set(recovery_completed or set())))
    offered = sorted(OPTIONAL & set(device_capabilities))
    return {"schema": "nori.first-boot-security.status.v1",
            "owner_session_allowed": not missing,
            "missing_required": missing,
            "optional_available": offered,
            "account_contacts_available": sorted(CONTACTS)}
