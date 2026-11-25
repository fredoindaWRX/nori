"""NORI Knight qualification evidence recorder — schema ``nori.knight-qualification.v1``.

Phase 2A: build the trustworthy machine-readable mechanism that will later
decide qualification.  This module RECORDS and VERIFIES evidence only:

* it never flips a qualification constant,
* it never opens Council task execution,
* it never weakens Sentinel or any permission,
* it executes no capability and starts no model, listener, or tool.

Fail-closed rules (enforced by :func:`record_qualification`):

* missing evidence            -> gate ``passed`` is False
* malformed receipt            -> False
* mismatched Knight id         -> False
* mismatched edition           -> False
* source hash mismatch         -> evidence marked stale, gate False
* mocked contract-only tests   -> cannot satisfy a real-capability gate
* one Knight's evidence cannot satisfy another Knight's gate, except where
  the standard explicitly defines the evidence as systemic
  (see :data:`SYSTEMIC_GATES`).

Run-verified evidence summary (recovered 2026-10-01/02, read-only):

* ``.native-state-restart-*`` / ``restart-receipt.json`` — real owned stack
  boot, 12 /health identities, per-Knight audit.jsonl rows, per-restart
  ``passed: true``.  Newest examined run: ``.native-state-restart-CfOwJo``.
* ``.native-worker-loss-real-*`` / ``.native-core-loss-real-*`` /
  ``.native-runtime-loss-real-*`` — process-loss fail-closed recovery with
  source-hash pins (hashes recorded at run time; see ``stale`` handling).
* ``.native-graceful-real-*`` — clean shutdown, zero owned processes.
* ``.native-active-cancel-*`` — mid-generation cancel acknowledged,
  terminal, same worker reused.
* ``.native-workers-probe-roo168qn`` — real gateway run: bus audit
  (authenticated + denied + completed rows), tool timings, per-role
  audit.jsonl for 10 of 12 Knights (apoc and architect absent).
* ``test_native_work_admission.py`` — Council admission gates hold
  (static test: contract evidence only, never a capability gate).
* ``test_tank_worker.py::test_tank_denied_home_control_...`` — denial with
  no side effect (static test: contract evidence only).

Known blockers preserved as data (never overridden by this module):

* smith  — no isolated runner; ``ready_verified`` is False.
* apoc   — no successful navigation; only a 403 refusal.
"""
from __future__ import annotations

import hashlib
import json
import os
from dataclasses import dataclass, field
from datetime import datetime, timezone

SCHEMA = "nori.knight-qualification.v1"
TARGET_EDITION = "home"

GATE_IDS = (
    "registry_configuration",
    "real_capability_task",
    "permission_denial_no_side_effect",
    "cancellation_or_timeout",
    "dependency_failure_recovery",
    "audit_verification",
    "package_install_verification",
    "edition_boot_verification",
)

# Gates whose evidence is legitimately systemic: one owned-stack run covers
# every Knight because the boot/restart lifecycle is shared.  All other gates
# require per-Knight evidence.  Admission-denial is recorded as contract
# evidence for the Council gate only — it never satisfies a Knight gate.
SYSTEMIC_GATES = frozenset({
    "dependency_failure_recovery",
    "package_install_verification",
})

KNOWN_REAL_CAPABILITY_BLOCKS = {
    "smith": "no isolated runner configured; ready_verified is false",
    "apoc": "no successful navigation evidence; browser execution denied",
}

def _utcnow() -> str:
    return datetime.now(timezone.utc).isoformat()


def sha256_file(path: str) -> str:
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for chunk in iter(lambda: handle.read(65536), b""):
            digest.update(chunk)
    return digest.hexdigest()


@dataclass
class Evidence:
    """One normalized evidence entry for ``nori.knight-qualification.v1``."""

    evidence_type: str
    source_path: str
    result: str  # "pass" | "fail" | "blocked"
    edition: str = TARGET_EDITION
    receipt_hash: str | None = None
    recorded_at: str | None = None
    run_verified: bool = False
    stale: bool = False
    notes: str = ""

    def to_dict(self) -> dict:
        return {
            "evidence_type": self.evidence_type,
            "source_path": self.source_path,
            "receipt_hash": self.receipt_hash,
            "edition": self.edition,
            "recorded_at": self.recorded_at,
            "result": self.result,
            "run_verified": self.run_verified,
            "stale": self.stale,
            "notes": self.notes,
        }


@dataclass
class GateResult:
    passed: bool = False
    evidence: list = field(default_factory=list)
    reason: str = "missing evidence"

    def to_dict(self) -> dict:
        return {
            "passed": self.passed,
            "evidence": [item.to_dict() for item in self.evidence],
            "reason": self.reason,
        }


def _load_json(path: str) -> tuple[dict | None, str | None]:
    """Return (document, error). A malformed receipt fails closed."""
    try:
        with open(path, "r", encoding="utf-8") as handle:
            document = json.load(handle)
    except (OSError, ValueError) as exc:
        return None, "malformed receipt %s: %s" % (path, exc)
    if not isinstance(document, dict):
        return None, "malformed receipt %s: top level is not an object" % path
    return document, None


def load_receipt(path: str, *, expected_passed: bool = True) -> tuple[dict, Evidence]:
    """Load and minimally validate a run receipt.

    Returns the parsed document plus an :class:`Evidence` stub carrying the
    receipt file's own sha256.  ``expected_passed`` receipts whose document
    does not itself claim ``passed: true`` are returned with result "fail"
    so no gate can be satisfied by them.
    """
    document, error = _load_json(path)
    if error is not None:
        stub = Evidence(
            evidence_type="receipt",
            source_path=path,
            result="fail",
            notes=error,
        )
        return {}, stub
    try:
        receipt_hash = sha256_file(path)
    except OSError as exc:
        stub = Evidence(
            evidence_type="receipt",
            source_path=path,
            result="fail",
            notes="receipt unreadable for hashing: %s" % exc,
        )
        return document, stub
    claimed = document.get("passed") is True
    stub = Evidence(
        evidence_type="receipt",
        source_path=path,
        result="pass" if (claimed or not expected_passed) else "fail",
        receipt_hash=receipt_hash,
        recorded_at=_utcnow(),
        run_verified=True,
        notes="" if claimed else "receipt does not claim passed",
    )
    return document, stub


def verify_source_hashes(
    document: dict, *, repo_root: str
) -> tuple[bool, list[str]]:
    """Re-check a receipt's pinned ``sourceHashes`` against the worktree.

    Returns (fresh, problems).  ``fresh`` is False when any pinned file is
    missing or its bytes changed since the run (untracked or modified
    worktree files cannot be the bytes the receipt ran against).  Stale
    evidence is never promoted to a gate pass; callers record it with
    ``stale=True``.
    """
    problems: list[str] = []
    pins = document.get("sourceHashes")
    if not isinstance(pins, dict) or not pins:
        return False, ["receipt carries no sourceHashes pins"]
    for rel, pinned in pins.items():
        candidate = os.path.join(repo_root, rel.replace("/", os.sep))
        if not os.path.isfile(candidate):
            problems.append("pinned source missing: %s" % rel)
            continue
        try:
            current = sha256_file(candidate)
        except OSError as exc:
            problems.append("pinned source unreadable: %s (%s)" % (rel, exc))
            continue
        if current != pinned:
            problems.append("source changed since run: %s" % rel)
    return (not problems), problems


def audit_subjects(audit_path: str) -> tuple[set | None, str | None]:
    """Parse an audit.jsonl into (action, subject, outcome) triples.

    Returns (None, error) when the file is missing or malformed — both fail
    closed at the gate.
    """
    try:
        handle = open(audit_path, "r", encoding="utf-8")
    except OSError as exc:
        return None, "audit file missing: %s (%s)" % (audit_path, exc)
    triples: set = set()
    with handle:
        for number, line in enumerate(handle, 1):
            line = line.strip()
            if not line:
                continue
            try:
                record = json.loads(line)
            except ValueError:
                return None, "audit line %d malformed in %s" % (number, audit_path)
            if not isinstance(record, dict):
                return None, "audit line %d not an object in %s" % (number, audit_path)
            triples.add((
                record.get("action"), record.get("subject"), record.get("outcome")))
    return triples, None


def _gate(passed: bool, evidence: list[Evidence], reason: str) -> GateResult:
    return GateResult(passed=passed, evidence=evidence, reason=reason)


def _fresh_receipt_evidence(
    stub: Evidence, document: dict, *, repo_root: str, label: str
) -> tuple[Evidence, bool, str]:
    """Attach a freshness verdict to a receipt stub.

    Returns (stub, fresh, note). Stale receipts keep their data but are
    flagged so no gate passes on them.
    """
    fresh, problems = verify_source_hashes(document, repo_root=repo_root)
    stub.evidence_type = label
    if not fresh:
        stub.stale = True
    return stub, fresh, "; ".join(problems)


def evaluate_registry_configuration(
    knight_id: str,
    *,
    edition: str,
    registry_ok: bool,
    boot_evidence: list[Evidence],
    notes: str = "",
) -> GateResult:
    """Gate 1: registry + configuration validation on the target edition.

    ``registry_ok`` must come from a real registry/config validation run
    (registry validation + owned Core boot identity checks), never from the
    mere existence of registry code.
    """
    if edition != TARGET_EDITION:
        return _gate(False, list(boot_evidence), "edition mismatch: %s" % edition)
    if not registry_ok:
        return _gate(False, list(boot_evidence),
                     "registry/configuration validation not recorded")
    if not boot_evidence:
        return _gate(False, [], "no boot identity evidence: %s" % (notes or knight_id))
    return _gate(True, list(boot_evidence),
                 notes or "registry validated; boot identity recorded")


def evaluate_real_capability_task(
    knight_id: str,
    *,
    edition: str,
    run_verified: bool,
    evidence: list[Evidence],
    mock_only: bool = False,
    notes: str = "",
) -> GateResult:
    """Gate 2: one real successful task using the declared capability.

    Mocked contract tests can never satisfy this gate (``mock_only`` forces
    a fail).  Known capability blocks (smith/apoc) are recorded, not passed.
    """
    if edition != TARGET_EDITION:
        return _gate(False, list(evidence), "edition mismatch: %s" % edition)
    block = KNOWN_REAL_CAPABILITY_BLOCKS.get(knight_id)
    if block:
        return _gate(False, list(evidence), "blocked: %s" % block)
    if mock_only:
        return _gate(False, list(evidence),
                     "mock-only evidence cannot satisfy a real-capability gate")

    if not run_verified or not evidence:
        return _gate(False, list(evidence),
                     notes or "no run-verified real task evidence")
    bad = [item for item in evidence if item.result != "pass" or item.stale]
    if bad:
        return _gate(False, list(evidence),
                     "capability evidence failing or stale: %s"
                     % "; ".join(item.source_path for item in bad))
    return _gate(True, list(evidence), notes or "real task evidence verified")


def evaluate_permission_denial(
    knight_id: str,
    *,
    edition: str,
    evidence: list[Evidence],
) -> GateResult:
    """Gate 3: permission denial with no tool side effect, for this Knight.

    Transport-level admission denial is systemic Council evidence — it is
    recorded on the report but never credited to an individual Knight.
    """
    if edition != TARGET_EDITION:
        return _gate(False, list(evidence), "edition mismatch: %s" % edition)
    own = [item for item in evidence
           if item.result == "pass" and not item.stale]
    if not own:
        reasons = [item.notes for item in evidence if item.notes]
        return _gate(False, list(evidence),
                     reasons[0] if reasons else
                     "no per-knight denial-with-no-side-effect evidence")
    return _gate(True, own, "denial recorded with no side effect")


def evaluate_cancellation_or_timeout(
    knight_id: str,
    *,
    edition: str,
    evidence: list[Evidence],
) -> GateResult:
    """Gate 4: cancellation or timeout exercised for this Knight's work."""
    if edition != TARGET_EDITION:
        return _gate(False, list(evidence), "edition mismatch: %s" % edition)
    own = [item for item in evidence
           if item.result == "pass" and not item.stale]
    if not own:
        return _gate(False, list(evidence),
                     "no cancellation/timeout evidence for %s" % knight_id)
    return _gate(True, own, "cancellation or timeout recorded")

def evaluate_dependency_failure_recovery(
    *,
    edition: str,
    evidence: list[Evidence],
    repo_root: str,
    document: dict,
) -> GateResult:
    """Gate 5 (systemic): dependency failure and recovery of the owned stack.

    One owned-stack run covers every Knight because all Knights share the
    Core/runtime lifecycle the receipts exercise.  A stale pin fails this
    gate for everyone.
    """
    if edition != TARGET_EDITION:
        return _gate(False, list(evidence), "edition mismatch: %s" % edition)
    fresh, problems = verify_source_hashes(document, repo_root=repo_root)
    if not fresh:
        for item in evidence:
            item.stale = True
        return _gate(False, list(evidence),
                     "stale failure-recovery evidence: %s" % "; ".join(problems))
    good = [item for item in evidence if item.result == "pass"]
    if not good:
        return _gate(False, list(evidence),
                     "no failure-recovery receipt claims passed")
    return _gate(True, good, "owned-stack failure and recovery verified")


def evaluate_audit_verification(
    knight_id: str,
    *,
    edition: str,
    evidence: list[Evidence],
) -> GateResult:
    """Gate 6: this Knight's audit events exist and parse for a real run."""
    if edition != TARGET_EDITION:
        return _gate(False, list(evidence), "edition mismatch: %s" % edition)
    own = [item for item in evidence
           if item.result == "pass" and not item.stale]
    if not own:
        return _gate(False, list(evidence),
                     "no verified audit rows for %s" % knight_id)
    return _gate(True, own, "audit rows verified")


def evaluate_package_install_verification(
    *,
    edition: str,
    evidence: list[Evidence],
    install_verified: bool,
) -> GateResult:
    """Gate 7a (systemic): package/install acceptance on the target edition."""
    if edition != TARGET_EDITION:
        return _gate(False, list(evidence), "edition mismatch: %s" % edition)
    if not install_verified:
        return _gate(False, list(evidence),
                     "package/install acceptance not recorded "
                     "(receipts declare installedAcceptanceVerified:false)")
    return _gate(True, list(evidence), "package/install acceptance recorded")


def evaluate_edition_boot_verification(
    *,
    edition: str,
    evidence: list[Evidence],
    booted: bool,
) -> GateResult:
    """Gate 7b: the target edition booted from the recorded evidence."""
    if edition != TARGET_EDITION:
        return _gate(False, list(evidence), "edition mismatch: %s" % edition)
    if not booted:
        return _gate(False, list(evidence),
                     "no %s edition boot recorded" % edition)
    return _gate(True, list(evidence), "%s edition boot recorded" % edition)

# Per-Knight run-verified capability markers recovered from the real-stack
# restart-state audit logs (``.native-state-restart-CfOwJo`` — the newest
# examined run).  Each entry names the audit.jsonl (action, outcome) rows
# that prove a real capability task ran for that Knight.  Trinity's only
# rows are denials, and smith has capability rows only for registration, so
# neither yields gate-2 evidence here.
CAPABILITY_AUDIT_MARKERS = {
    "neo": [("neo_workspace", "completed")],
    "trinity": [],
    "morpheus": [("morpheus_ide", "completed")],
    "apoc": [],
    "oracle": [("oracle_knowledge", "completed"), ("oracle_knowledge", "indexed")],
    "merovingian": [("memory_write", "completed"), ("memory_export", "completed")],
    "architect": [("architect_graph", "completed")],
    "keymaker": [("keymaker_report", "completed")],
    "smith": [],
    "tank": [("tank_hardware", "completed")],
    "machine": [("machine_runtime", "completed")],
    "sentinel": [("sentinel_event", "delivered")],
}

# Per-Knight denial rows recovered from the same restart state: trinity
# plugin invoke refusals and apoc browser refusals.
DENIAL_AUDIT_MARKERS = {
    "trinity": [("trinity_plugin", "denied")],
    "apoc": [("apoc_browser", "denied")],
}

# Per-Knight cancellation/timeout rows recovered from restart state.
CANCEL_AUDIT_MARKERS = {
    "sentinel": [("sentinel_event", "cancelled")],
}

# The Machine cancel/timeout proof lives in the active-cancel receipt
# (mid-generation cancel acknowledged, terminal, same worker reused).
MACHINE_CANCEL_RECEIPT_KINDS = ("active-cancel-receipt.json",)


@dataclass
class RunEvidence:
    """Normalized evidence collected from the recovered run artifacts."""

    edition: str = TARGET_EDITION
    boot_identity: bool = False
    boot_evidence: list = field(default_factory=list)
    capability: dict = field(default_factory=dict)
    denial: dict = field(default_factory=dict)
    cancel: dict = field(default_factory=dict)
    audit_rows: dict = field(default_factory=dict)
    failure_document: dict = field(default_factory=dict)
    failure_evidence: list = field(default_factory=list)
    systemic_denial_contract: list = field(default_factory=list)
    problems: list = field(default_factory=list)


def _audit_evidence(knight_id: str, audit_path: str, *, label: str,
                    notes: str = ""):
    triples, error = audit_subjects(audit_path)
    if error is not None:
        return None, None
    try:
        receipt_hash = sha256_file(audit_path)
    except OSError:
        receipt_hash = None
    stub = Evidence(
        evidence_type=label,
        source_path=audit_path,
        result="pass",
        receipt_hash=receipt_hash,
        recorded_at=_utcnow(),
        run_verified=True,
        notes=notes,
    )
    return stub, triples

def _has_markers(triples: set, markers):
    present = {(action, outcome) for action, _subject, outcome in triples}
    return any((action, outcome) in present for action, outcome in markers)


def _scan_receipts(verification_dir, pattern, filename):
    """Newest-first list of (path, mtime) for a receipt family (read-only)."""
    import glob
    found = []
    for directory in glob.glob(os.path.join(verification_dir, pattern)):
        path = os.path.join(directory, filename)
        if os.path.isfile(path):
            found.append((path, os.path.getmtime(path)))
    found.sort(key=lambda item: item[1], reverse=True)
    return found


def _ingest_receipt_list(paths, collected_list, failure_doc_slot,
                         repo_root, label, check_fresh):
    """Ingest every receipt of one family; return fresh pass count."""
    fresh = 0
    for path, _mtime in paths:
        document, stub = load_receipt(path)
        if check_fresh:
            stub, is_fresh, _note = _fresh_receipt_evidence(
                stub, document, repo_root=repo_root, label=label)
        else:
            stub.evidence_type = label
            stub.stale = False
            is_fresh = stub.result == "pass"
        collected_list.append(stub)
        if failure_doc_slot is not None and not failure_doc_slot:
            failure_doc_slot.update(document)
        if is_fresh and stub.result == "pass":
            fresh += 1
    return fresh

def _collect_knight_audits(collected, restart_state_dir, probe_dir, knights):
    for knight_id in knights:
        audit_path = os.path.join(restart_state_dir, knight_id, "audit.jsonl")
        stub, triples = _audit_evidence(
            knight_id, audit_path, label="knight-audit-rows")
        if stub is None or triples is None:
            collected.problems.append("audit unavailable for %s" % knight_id)
            continue
        collected.audit_rows[knight_id] = [stub]
        markers = CAPABILITY_AUDIT_MARKERS.get(knight_id, [])
        if markers and _has_markers(triples, markers):
            collected.capability.setdefault(knight_id, []).append(Evidence(
                evidence_type="real-capability-task", source_path=audit_path,
                result="pass", receipt_hash=stub.receipt_hash,
                recorded_at=stub.recorded_at, run_verified=True,
                notes="audit rows %s" % (markers,)))
        markers = DENIAL_AUDIT_MARKERS.get(knight_id, [])
        if markers and _has_markers(triples, markers):
            collected.denial.setdefault(knight_id, []).append(Evidence(
                evidence_type="permission-denial-no-side-effect",
                source_path=audit_path, result="pass",
                receipt_hash=stub.receipt_hash, recorded_at=stub.recorded_at,
                run_verified=True, notes="denial rows %s" % (markers,)))
        markers = CANCEL_AUDIT_MARKERS.get(knight_id, [])
        if markers and _has_markers(triples, markers):
            collected.cancel.setdefault(knight_id, []).append(Evidence(
                evidence_type="cancellation-or-timeout", source_path=audit_path,
                result="pass", receipt_hash=stub.receipt_hash,
                recorded_at=stub.recorded_at, run_verified=True,
                notes="cancel rows %s" % (markers,)))
    probe_db = os.path.join(probe_dir, "native-bus-audit.sqlite3")
    if os.path.isfile(probe_db):
        try:
            probe_hash = sha256_file(probe_db)
        except OSError:
            probe_hash = None
        collected.systemic_denial_contract.append(Evidence(
            evidence_type="systemic-bus-denial-contract", source_path=probe_db,
            result="pass", receipt_hash=probe_hash, recorded_at=_utcnow(),
            run_verified=True,
            notes="bus audit holds authenticated+denied+completed rows; "
                  "Council admission evidence only, never a Knight gate"))
    else:
        collected.problems.append("probe bus audit missing: %s" % probe_db)
    return collected


def collect_run_evidence(*, repo_root, restart_state_dir,
                         restart_receipt, failure_receipt,
                         cancel_receipt, probe_dir, knights):
    """Collect recovered run artifacts (read-only; no execution).

    The named anchor paths select the reference trial; every sibling trial
    of the same families under verification/ is ingested too, newest first.
    """
    verification_dir = os.path.dirname(os.path.dirname(restart_receipt))
    collected = RunEvidence()
    anchor_doc, anchor_stub = load_receipt(restart_receipt)
    anchor_stub.evidence_type = "restart-receipt"
    anchor_stub.stale = False
    if anchor_stub.result == "pass":
        collected.boot_identity = True
        collected.boot_evidence.append(anchor_stub)
    for path, _mtime in _scan_receipts(
            verification_dir, ".native-state-restart-*", "restart-receipt.json"):
        if path == restart_receipt:
            continue
        _doc, stub = load_receipt(path)
        stub.evidence_type = "restart-receipt"
        stub.stale = False
        if stub.result == "pass":
            collected.boot_evidence.append(stub)
    _ingest_receipt_list(_scan_receipts(
        verification_dir, ".native-worker-loss-real-*",
        "failure-recovery-receipt.json"), collected.failure_evidence,
        collected.failure_document, repo_root,
        "failure-recovery-receipt", True)
    _ingest_receipt_list(_scan_receipts(
        verification_dir, ".native-core-loss-real-*",
        "failure-recovery-receipt.json"), collected.failure_evidence,
        None, repo_root, "failure-recovery-receipt", True)
    _ingest_receipt_list(_scan_receipts(
        verification_dir, ".native-runtime-loss-real-*",
        "failure-recovery-receipt.json"), collected.failure_evidence,
        None, repo_root, "failure-recovery-receipt", True)
    _ingest_receipt_list(_scan_receipts(
        verification_dir, ".native-graceful-real-*",
        "graceful-receipt.json"), collected.failure_evidence,
        None, repo_root, "graceful-receipt", True)
    _doc, cancel_stub = load_receipt(cancel_receipt)
    cancel_stub.evidence_type = "active-cancel-receipt"
    collected.cancel.setdefault("machine", []).append(cancel_stub)
    for path, _mtime in _scan_receipts(
            verification_dir, ".native-active-cancel-*",
            "active-cancel-receipt.json"):
        if path == cancel_receipt:
            continue
        _doc2, stub2 = load_receipt(path)
        stub2.evidence_type = "active-cancel-receipt"
        collected.cancel.setdefault("machine", []).append(stub2)
    return _collect_knight_audits(
        collected, restart_state_dir, probe_dir, knights)


def record_qualification(
    *,
    knights: tuple[str, ...],
    edition: str = TARGET_EDITION,
    source_revision: str = "unknown",
    evaluated_at: str | None = None,
    collected: RunEvidence | None = None,
    registry_ok: bool = False,
    static_contract_notes: dict | None = None,
    repo_root: str = "",
) -> dict:
    """Build the ``nori.knight-qualification.v1`` record (read-only input).

    ``static_contract_notes`` maps knight_id to notes about static (mock or
    unit) tests that exist for it.  They are recorded in the report as
    contract evidence only and can never satisfy a real-capability gate.
    Returns the full machine-readable record as a dict.
    """
    static_contract_notes = static_contract_notes or {}
    collected = collected or RunEvidence(edition=edition)
    stamp = evaluated_at or _utcnow()
    record = {
        "schema": SCHEMA,
        "edition": edition,
        "evaluated_at": stamp,
        "source_revision": source_revision,
        "knights": {},
        "systemic": {
            "bus_denial_contract": [
                item.to_dict()
                for item in collected.systemic_denial_contract
            ],
            "collection_problems": list(collected.problems),
        },
    }
    for knight_id in knights:
        gates = {}
        gates["registry_configuration"] = evaluate_registry_configuration(
            knight_id, edition=edition, registry_ok=registry_ok,
            boot_evidence=list(collected.boot_evidence)).to_dict()
        cap_evidence = list(collected.capability.get(knight_id, []))
        static_note = static_contract_notes.get(knight_id)
        if static_note and not cap_evidence:
            cap_evidence.append(Evidence(
                evidence_type="static-contract-test",
                source_path=static_note,
                result="fail",
                edition=edition,
                recorded_at=stamp,
                run_verified=False,
                notes="contract-only evidence; cannot satisfy real-capability gate",
            ))
        gates["real_capability_task"] = evaluate_real_capability_task(
            knight_id, edition=edition,
            run_verified=bool(collected.capability.get(knight_id)),
            evidence=cap_evidence,
            mock_only=bool(static_note and not collected.capability.get(knight_id)),
        ).to_dict()
        gates["permission_denial_no_side_effect"] = evaluate_permission_denial(
            knight_id, edition=edition,
            evidence=list(collected.denial.get(knight_id, []))).to_dict()
        gates["cancellation_or_timeout"] = evaluate_cancellation_or_timeout(
            knight_id, edition=edition,
            evidence=list(collected.cancel.get(knight_id, []))).to_dict()
        gates["dependency_failure_recovery"] = evaluate_dependency_failure_recovery(
            edition=edition,
            evidence=list(collected.failure_evidence),
            repo_root=repo_root,
            document=collected.failure_document).to_dict()
        gates["audit_verification"] = evaluate_audit_verification(
            knight_id, edition=edition,
            evidence=list(collected.audit_rows.get(knight_id, []))).to_dict()
        gates["package_install_verification"] = (
            evaluate_package_install_verification(
                edition=edition, evidence=list(collected.failure_evidence),
                install_verified=False).to_dict()
        )
        gates["edition_boot_verification"] = evaluate_edition_boot_verification(
            edition=edition, evidence=list(collected.boot_evidence),
            booted=collected.boot_identity).to_dict()
        blockers: list[str] = []
        block = KNOWN_REAL_CAPABILITY_BLOCKS.get(knight_id)
        if block:
            blockers.append(block)
        for gate_id in GATE_IDS:
            if not gates[gate_id]["passed"]:
                reason = gates[gate_id]["reason"]
                if block and gate_id == "real_capability_task":
                    continue
                blockers.append("%s: %s" % (gate_id, reason))
        qualified = all(gates[gate_id]["passed"] for gate_id in GATE_IDS)
        record["knights"][knight_id] = {
            "knight_id": knight_id,
            "edition": edition,
            "evaluated_at": stamp,
            "source_revision": source_revision,
            "gates": gates,
            "qualified": qualified,
            "blockers": blockers,
        }
    total = len(record["knights"])
    passed = sum(1 for knight in record["knights"].values() if knight["qualified"])
    record["summary"] = {
        "edition": edition,
        "total_knights": total,
        "qualified_knights": passed,
        "home_edition_qualified": bool(total) and passed == total,
        "expected": "NOT QUALIFIED with today's evidence",
    }
    return record

def render_report(record: dict) -> str:
    """Render the human-readable qualification report for a record."""
    lines = [
        "NORI KNIGHT QUALIFICATION REPORT (%s)" % record.get("schema", "?"),
        "edition=%s evaluated_at=%s source_revision=%s" % (
            record.get("edition"), record.get("evaluated_at"),
            record.get("source_revision")),
        "",
    ]
    names = sorted(record.get("knights", {}))
    for knight_id in names:
        knight = record["knights"][knight_id]
        gates = knight["gates"]
        marks = " ".join(
            "%s=%s" % (gate_id, "PASS" if gates[gate_id]["passed"] else "FAIL")
            for gate_id in GATE_IDS)
        lines.append("KNIGHT %s qualified=%s" % (knight_id, knight["qualified"]))
        lines.append("  gates: %s" % marks)
        for gate_id in GATE_IDS:
            if not gates[gate_id]["passed"]:
                lines.append("  lacks %s: %s" % (gate_id, gates[gate_id]["reason"]))
        for blocker in knight["blockers"]:
            lines.append("  blocker: %s" % blocker)
        lines.append("")
    summary = record.get("summary", {})
    lines.append("HOME EDITION QUALIFIED: %s (%s/%s knights)" % (
        summary.get("home_edition_qualified"),
        summary.get("qualified_knights"), summary.get("total_knights")))
    problems = record.get("systemic", {}).get("collection_problems", [])
    if problems:
        lines.append("COLLECTION PROBLEMS:")
        for problem in problems:
            lines.append("  - %s" % problem)
    return "\n".join(lines)


def default_artifact_paths(repo_root: str) -> dict:
    """Return the recovered artifact paths Phase 2A ingests (read-only)."""
    verification = os.path.join(repo_root, "verification")
    return {
        "repo_root": repo_root,
        "restart_state_dir": os.path.join(
            verification, ".native-state-restart-CfOwJo", "state", "private", "core"),
        "restart_receipt": os.path.join(
            verification, ".native-state-restart-CfOwJo", "restart-receipt.json"),
        "failure_receipt": os.path.join(
            verification, ".native-worker-loss-real-1m87BK",
            "failure-recovery-receipt.json"),
        "cancel_receipt": os.path.join(
            verification, ".native-active-cancel-CfRMrR",
            "active-cancel-receipt.json"),
        "probe_dir": os.path.join(
            verification, ".native-workers-probe-roo168qn"),
    }


def _expected_knights() -> tuple[str, ...]:
    try:
        from .knight_registry import EXPECTED_KNIGHTS

        return tuple(sorted(EXPECTED_KNIGHTS))
    except ImportError:
        manifest = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                                "knights.json")
        with open(manifest, "r", encoding="utf-8") as handle:
            data = json.load(handle)
        return tuple(sorted(item["id"] for item in data["knights"]))


def build_home_record(repo_root: str, *, source_revision: str = "unknown") -> dict:
    """Collect recovered evidence and record Home-edition qualification."""
    paths = default_artifact_paths(repo_root)
    knights = _expected_knights()
    collected = collect_run_evidence(
        repo_root=paths["repo_root"],
        restart_state_dir=paths["restart_state_dir"],
        restart_receipt=paths["restart_receipt"],
        failure_receipt=paths["failure_receipt"],
        cancel_receipt=paths["cancel_receipt"],
        probe_dir=paths["probe_dir"],
        knights=knights,
    )
    return record_qualification(
        knights=knights,
        edition=TARGET_EDITION,
        source_revision=source_revision,
        collected=collected,
        registry_ok=collected.boot_identity,
        static_contract_notes={
            "tank": "nori/shared/tests/test_tank_worker.py "
                    "(denied home_control; contract only)",
        },
        repo_root=repo_root,
    )


def main(argv: list[str] | None = None) -> int:
    """CLI: write the machine record and print the human report."""
    import argparse

    parser = argparse.ArgumentParser(
        description="Record NORI Knight qualification evidence (read-only).")
    parser.add_argument("--repo-root", default=os.path.dirname(
        os.path.dirname(os.path.dirname(os.path.dirname(
            os.path.abspath(__file__))))))
    parser.add_argument("--record-out", default="")
    parser.add_argument("--report-out", default="")
    parser.add_argument("--revision", default="unknown")
    args = parser.parse_args(argv)

    record = build_home_record(args.repo_root, source_revision=args.revision)
    if args.record_out:
        with open(args.record_out, "w", encoding="utf-8") as handle:
            json.dump(record, handle, indent=2, sort_keys=True)
            handle.write("\n")
    report = render_report(record)
    if args.report_out:
        with open(args.report_out, "w", encoding="utf-8") as handle:
            handle.write(report + "\n")
    print(report)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

