"""Qualification-evidence recorder tests — contract only, never capability.

These tests exercise the fail-closed rules of
``orchestration.knight_qualification`` with synthetic fixtures in tmp dirs.
They start no model, listener, tool, or Knight, and they never touch the
qualification constants in main.py / native-core.cjs / nori-v2-query.mjs /
work_sessions.py / knight_readiness.py.
"""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from orchestration import knight_qualification as kq

KNIGHTS_12 = ("neo", "trinity", "morpheus", "apoc", "oracle", "merovingian",
              "architect", "keymaker", "smith", "tank", "machine", "sentinel")


def _receipt(tmp_path, name="receipt.json", passed=True, pins=None):
    doc = {"passed": passed}
    if pins is not None:
        doc["sourceHashes"] = pins
    target = tmp_path / name
    target.write_text(json.dumps(doc), encoding="utf-8")
    return str(target)


def _pinned_repo(tmp_path, rel="nori/main.py", body=b"x"):
    target = tmp_path / rel
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(body)
    return rel, kq.sha256_file(str(target))


def test_valid_evidence_accepted(tmp_path):
    rel, digest = _pinned_repo(tmp_path)
    receipt = _receipt(tmp_path, pins={rel: digest})
    document, stub = kq.load_receipt(receipt)
    assert stub.result == "pass"
    fresh, problems = kq.verify_source_hashes(document, repo_root=str(tmp_path))
    assert fresh and problems == []


def test_missing_evidence_fails_closed():
    collected = kq.RunEvidence(edition="home")
    record = kq.record_qualification(knights=KNIGHTS_12, collected=collected,
                                     repo_root="nowhere")
    assert record["schema"] == "nori.knight-qualification.v1"
    for knight_id in KNIGHTS_12:
        gates = record["knights"][knight_id]["gates"]
        assert set(gates) == set(kq.GATE_IDS)
        assert all(gates[gate]["passed"] is False for gate in kq.GATE_IDS)
        assert record["knights"][knight_id]["qualified"] is False
    assert record["summary"]["home_edition_qualified"] is False


def test_corrupt_receipt_fails_closed(tmp_path):
    bad = tmp_path / "receipt.json"
    bad.write_text("{not json", encoding="utf-8")
    document, stub = kq.load_receipt(str(bad))
    assert document == {}
    assert stub.result == "fail"
    assert "malformed" in stub.notes

def test_wrong_knight_evidence_rejected(tmp_path):
    audit = tmp_path / "neo" / "audit.jsonl"
    audit.parent.mkdir(parents=True)
    audit.write_text(json.dumps({"action": "neo_workspace", "subject": "x",
                                 "outcome": "completed"}) + "\n", encoding="utf-8")
    triples, error = kq.audit_subjects(str(audit))
    assert error is None
    # Attribution is per-Knight: tank has no marker rows in neo's log, so
    # the collector rule never credits tank with neo's capability evidence.
    assert kq._has_markers(triples, kq.CAPABILITY_AUDIT_MARKERS["neo"])
    assert not kq._has_markers(triples, kq.CAPABILITY_AUDIT_MARKERS["tank"])


def test_wrong_edition_rejected():
    evidence = [kq.Evidence(evidence_type="x", source_path="s", result="pass",
                            run_verified=True)]
    gates = (
        kq.evaluate_registry_configuration("neo", edition="server",
                                           registry_ok=True,
                                           boot_evidence=evidence),
        kq.evaluate_real_capability_task("neo", edition="server",
                                         run_verified=True, evidence=evidence),
        kq.evaluate_permission_denial("neo", edition="server",
                                      evidence=evidence),
        kq.evaluate_cancellation_or_timeout("neo", edition="server",
                                            evidence=evidence),
        kq.evaluate_audit_verification("neo", edition="server",
                                       evidence=evidence),
    )
    for gate in gates:
        assert gate.passed is False
        assert "edition mismatch" in gate.reason


def test_hash_mismatch_rejected(tmp_path):
    rel, _digest = _pinned_repo(tmp_path, body=b"original")
    receipt = _receipt(tmp_path, pins={rel: "0" * 64})
    document, stub = kq.load_receipt(receipt)
    assert stub.result == "pass"  # the receipt itself is well-formed
    fresh, problems = kq.verify_source_hashes(document, repo_root=str(tmp_path))
    assert fresh is False and problems
    gate = kq.evaluate_dependency_failure_recovery(
        edition="home", evidence=[stub], repo_root=str(tmp_path),
        document=document)
    assert gate.passed is False
    assert stub.stale is True


def test_mock_only_evidence_cannot_satisfy_real_capability():
    evidence = [kq.Evidence(evidence_type="static-contract-test",
                            source_path="test_something.py", result="fail",
                            run_verified=False,
                            notes="contract-only evidence")]
    gate = kq.evaluate_real_capability_task(
        "neo", edition="home", run_verified=False,
        evidence=evidence, mock_only=True)
    assert gate.passed is False
    assert "mock-only" in gate.reason


def test_all_twelve_knights_appear_in_output():
    collected = kq.RunEvidence(edition="home")
    record = kq.record_qualification(knights=KNIGHTS_12, collected=collected,
                                     repo_root="nowhere")
    assert sorted(record["knights"]) == sorted(KNIGHTS_12)
    for knight_id in KNIGHTS_12:
        node = record["knights"][knight_id]
        assert node["knight_id"] == knight_id
        assert node["edition"] == "home"
        assert "qualified" in node and "blockers" in node


def _today_record():
    paths = kq.default_artifact_paths(r"C:\Nori")
    knights = tuple(sorted(KNIGHTS_12))
    collected = kq.collect_run_evidence(
        repo_root=paths["repo_root"],
        restart_state_dir=paths["restart_state_dir"],
        restart_receipt=paths["restart_receipt"],
        failure_receipt=paths["failure_receipt"],
        cancel_receipt=paths["cancel_receipt"],
        probe_dir=paths["probe_dir"],
        knights=knights,
    )
    return kq.record_qualification(
        knights=knights, collected=collected, registry_ok=True,
        repo_root=paths["repo_root"])


def test_overall_qualified_remains_false_with_todays_evidence():
    record = _today_record()
    assert record["summary"]["total_knights"] == 12
    assert record["summary"]["home_edition_qualified"] is False
    assert record["summary"]["qualified_knights"] == 0


def test_smith_and_apoc_remain_blocked():
    record = _today_record()
    for knight_id in ("smith", "apoc"):
        gates = record["knights"][knight_id]["gates"]
        assert gates["real_capability_task"]["passed"] is False
        assert "blocked" in gates["real_capability_task"]["reason"]
        assert record["knights"][knight_id]["qualified"] is False
