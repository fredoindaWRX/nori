"""Truthful, machine-readable NORI Core acceptance report."""
from __future__ import annotations

import json
from pathlib import Path


REQUIRED = {
    "identity": ["shared/identity/first_boot_security.py", "shared/runtime/node_enrollment.py"],
    "memory": ["shared/memory/nori_memory.py"],
    "state_event_bus": ["bus.py", "council_gateway.py"],
    "privileged_service": ["shared/orchestration/knight_service.py"],
    "worker_orchestration": ["shared/orchestration/architect_worker.py", "shared/orchestration/knight_runtime.py"],
    "voice": ["shared/voice/listen-windows-speech.ps1"],
    "tools": ["shared/orchestration/knight_runtime.py", "tool_capabilities.py"],
    "audit_logs": ["shared/audit/nori_audit.py"],
    "backup_verify_rollback": ["shared/updates/nori_update_manager.py", "shared/learning/candidate_gate.py"]
}

PAIRING_FILES = [
    "shared/runtime/node_enrollment.py",
    "shared/runtime/node_transport.py",
    "shared/runtime/nori_nexus_service.py",
]


def evaluate(root: Path, config: dict) -> dict:
    root = Path(root).resolve()
    components = {}
    for name, files in REQUIRED.items():
        missing = [path for path in files if not (root / path).is_file()]
        components[name] = {"status": "present" if not missing else "missing", "missing": missing}
    security = config.get("security", {})
    network = config.get("network", {})
    limitations = []
    if not security.get("tpm_enabled"):
        components["identity"]["status"] = "partial"
        limitations.append("TPM owner-key binding is not active")
    if security.get("heartbeat_status") != "integrated":
        limitations.append("production heartbeat supervision is not integrated")
    heartbeat = security.get('heartbeat_service')
    if heartbeat is not None:
        candidate = Path(heartbeat) if isinstance(heartbeat, str) and heartbeat else None
        if candidate is not None and not candidate.is_absolute():
            candidate = root / candidate
        present = candidate is not None and candidate.is_file()
        components['heartbeat_supervision'] = {
            'status': 'present' if present else 'missing',
            'missing': [] if present else ['configured heartbeat supervisor'],
        }
        if not present:
            limitations.append('configured heartbeat supervisor source is missing; integrated label is not evidence')
    if network.get("remote_traffic") != "verified_private_pairing_only":
        limitations.append("remote node transport is not yet verified for production")
    if config.get("autonomy", {}).get("tool_execution_status", "").startswith("guarded"):
        components["tools"]["status"] = "partial"
        limitations.append("some execution adapters remain intentionally unavailable until isolated runners are configured")
    blocking = [name for name, value in components.items() if value["status"] == "missing"]
    pairing_missing = [path for path in PAIRING_FILES if not (root / path).is_file()]
    pairing = {
        "implementation": "present" if not pairing_missing else "missing",
        "missing": pairing_missing,
        # Source/tests prove the protocol implementation; only a real paired
        # node can prove the physical transport and is reported separately.
        "physical_remote_node": "verified" if network.get("physical_pairing") is True else "pending",
    }
    if pairing_missing:
        blocking.append("pairing_transport")
    from orchestration.knight_registry import EXPECTED_KNIGHTS
    roster = {}
    for role in sorted(EXPECTED_KNIGHTS):
        files = [f'shared/orchestration/{role}_worker.py', f'packages/knights/{role}/agent.manifest.json']
        missing = [path for path in files if not (root / path).is_file()]
        roster[role] = {'source_present': not missing, 'missing': missing,
                        'functional_qualification': 'not_evaluated'}
    if any(not entry['source_present'] for entry in roster.values()):
        blocking.append('native_knight_sources')
    return {"schema": "nori.core-readiness.v1", "components": components,
            "assessment_scope": "source_inventory_and_configuration_only",
            "release_verified": False, "native_knights": roster,
            "pairing": pairing,
            "blocking_missing_components": blocking, "limitations": limitations,
            "status": "ready_with_limitations" if not blocking else "incomplete"}


def write_report(root: Path, destination: Path) -> dict:
    root = Path(root).resolve()
    config = json.loads((root / "config.yaml").read_text(encoding="utf-8"))
    report = evaluate(root, config)
    destination = Path(destination)
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text(json.dumps(report, indent=2), encoding="utf-8")
    return report
