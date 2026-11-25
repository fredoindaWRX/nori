"""Read-only verification of the owner's existing isolated coding receipt.

Does not start a worker, approve/resume a task, or modify the task database.
An execution receipt digest is recorded evidence, not a rechecked transcript.
"""
import hashlib
import json
from pathlib import Path
import sqlite3


def verify():
    task_id = "10a56ea33cfffe4a84598715e9fca49d"
    root = Path(r"C:\Nori\dev\neurons-coding-acceptance").resolve(strict=True)
    calculator = root / "calculator.py"
    context = {root / "test_add.py", root / "test_calculator.py"}
    store = Path(r"C:\Users\Studio\AppData\Local\Nori\state\core\worker-jobs\worker.sqlite3")
    with sqlite3.connect(store.resolve(strict=True).as_uri() + "?mode=ro", uri=True) as db:
        row = db.execute("SELECT body FROM jobs WHERE id=?", (task_id,)).fetchone()
    if row is None:
        raise ValueError("Expected acceptance task is absent")
    state = json.loads(row[0])
    result = state.get("result") or {}
    order = state.get("order") or {}
    if state.get("task_id") != task_id or state.get("status") != "completed":
        raise ValueError("Acceptance task is not recorded completed")
    if result.get("outcome") != "completed" or result.get("worker") != "aider-local":
        raise ValueError("Expected completed local Aider result is absent")
    if [Path(p) for p in order.get("allowed_files", [])] != [calculator]:
        raise ValueError("Editable scope differs from calculator.py only")
    if {Path(p) for p in order.get("context_files", [])} != context:
        raise ValueError("Read-only test context differs")
    if [Path(p) for p in result.get("changed_files", [])] != [calculator]:
        raise ValueError("Recorded changed-file scope differs")
    evidence = result.get("evidence") or {}
    receipts = evidence.get("receipts") or []
    execution = [r for r in receipts if r.get("kind") == "execution" and r.get("subject") == task_id]
    readbacks = [r for r in receipts if r.get("kind") == "readback" and Path(r.get("subject", "")) == calculator]
    if len(execution) != 1 or len(readbacks) != 1:
        raise ValueError("Expected execution and readback receipts are absent or ambiguous")
    if calculator.resolve(strict=True) != calculator:
        raise ValueError("Calculator resolves outside its expected physical path")
    current = hashlib.sha256(calculator.read_bytes()).hexdigest()
    if current != readbacks[0].get("digest"):
        raise ValueError("Current calculator differs from the completed worker readback")
    return {
        "task_id": task_id, "recorded_worker": "aider-local",
        "recorded_status": "completed", "editable_scope_matches": True,
        "context_scope_matches": True, "current_readback_matches": True,
        "calculator_sha256": current, "execution_receipt_recorded": True,
        "execution_transcript_reverified": False, "tests_run_by_this_script": False,
        "database_opened_read_only": True, "task_resumed_or_approved": False,
    }


if __name__ == "__main__":
    print(json.dumps(verify(), indent=2))
