"""Internet authority contract for N.O.R.I.

N.O.R.I. is allowed to use the internet for project work, research, downloads,
device integration, and troubleshooting. This module keeps that authority
explicit, logged, and fail-closed for risky actions.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from typing import Any
import time
import uuid


SCHEMA = "nori.internet_authority.v1"

ALLOWED_PURPOSES = frozenset(
    {
        "research",
        "documentation",
        "dependency_download",
        "tool_install",
        "device_integration",
        "troubleshooting",
        "project_verification",
    }
)

HIGH_RISK_NETWORK_ACTIONS = frozenset(
    {
        "credential_submission",
        "payment",
        "account_deletion",
        "public_post",
        "send_email",
        "remote_shell_to_unknown_host",
    }
)


@dataclass(frozen=True)
class InternetRequest:
    request_id: str
    purpose: str
    summary: str
    allow_downloads: bool = True
    require_evidence: bool = True
    created_at: float = field(default_factory=time.time)

    def dict(self) -> dict[str, Any]:
        return asdict(self)


def authorize_internet_use(
    purpose: str,
    summary: str,
    *,
    action: str = "research",
    allow_downloads: bool = True,
) -> dict[str, Any]:
    purpose = str(purpose or "").strip().casefold()
    summary = str(summary or "").strip()
    action = str(action or "").strip().casefold()
    if purpose not in ALLOWED_PURPOSES:
        return {
            "authorized": False,
            "error": "internet_purpose_not_allowlisted",
            "allowed_purposes": sorted(ALLOWED_PURPOSES),
        }
    if not summary:
        return {"authorized": False, "error": "summary_required"}
    if action in HIGH_RISK_NETWORK_ACTIONS:
        return {
            "authorized": False,
            "error": "high_risk_network_action_requires_owner_override",
            "action": action,
        }
    request = InternetRequest(
        request_id=f"nori-net-{uuid.uuid4().hex[:16]}",
        purpose=purpose,
        summary=summary,
        allow_downloads=allow_downloads,
    ).dict()
    request.update(
        {
            "authorized": True,
            "mode": "nori_logged_internet_access",
            "install_policy": "dependency_allowlist_required_for_packages",
            "evidence_policy": "source_url_or_download_hash_required_when_available",
        }
    )
    return request


def internet_authority_status() -> dict[str, Any]:
    return {
        "schema": SCHEMA,
        "enabled": True,
        "allowed_purposes": sorted(ALLOWED_PURPOSES),
        "downloads_allowed": True,
        "high_risk_actions_blocked_without_override": sorted(HIGH_RISK_NETWORK_ACTIONS),
        "evidence_required": True,
    }
