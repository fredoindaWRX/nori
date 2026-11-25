"""Exercise live capability creation and reuse through the authenticated desktop API.

Run explicitly after restarting NORI. Completion prose is never accepted as proof:
the report checks durable session records and the isolated runner's hashed output.
No owner credential is written to the report or printed.
"""
from __future__ import annotations

import argparse
import asyncio
from contextlib import contextmanager
import hashlib
import json
import os
from pathlib import Path
import re
import secrets
import sys
from threading import Thread
import time
from urllib.request import Request, urlopen
from uuid import uuid4


ROOT = Path(__file__).resolve().parents[1]
BASE_URL = 'http://127.0.0.1:9107'
TERMINAL = {"completed", "failed", "blocked", "cancelled", "interrupted"}


def request(path, token, body=None):
    data = None if body is None else json.dumps(body).encode("utf-8")
    req = Request(BASE_URL + path, data=data,
                  headers={"Authorization": "Bearer " + token,
                           "Content-Type": "application/json"})
    with urlopen(req, timeout=20) as response:
        return json.load(response)


def write_report(path, report):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(report, indent=2, ensure_ascii=False), encoding="utf-8")


@contextmanager
def isolated_runtime():
    """Test current code on an ephemeral port with its own state; leave the app alone.

    Uses the real installed local models, Sentinel, tools and isolated runner.
    Only the test's HTTP listener is started/stopped. No production restart.
    """
    global BASE_URL
    sys.path.insert(0, str(ROOT))
    from main import Worker, CouncilHTTPServer, handler, load_config
    from council_gateway import CouncilGateway
    from work_sessions import WorkSessionManager
    from orchestration.wsl_python_runner import WslPythonRunner
    data = ROOT / 'runtime-data' / 'acceptance' / uuid4().hex
    data.mkdir(parents=True)
    token = secrets.token_urlsafe(48)
    (data / 'secrets').mkdir()
    (data / 'secrets/council-token').write_text(token, encoding='utf-8')
    previous_data, previous_url = os.environ.get('NORI_DATA_ROOT'), BASE_URL
    os.environ['NORI_DATA_ROOT'] = str(data)
    config = load_config(ROOT / 'config.yaml')
    workers = {name: Worker(config, name) for name in config['startup_order']}
    # Use the existing task-workspace boundary; acceptance metadata/secrets stay
    # outside that root and production workspaces are never reused.
    workers['neo'].runtime.neo_worker.root = (ROOT / 'runtime-data' /
        'capability-acceptance' / 'workspace' / data.name)
    gateway = CouncilGateway(workers, token, data / 'sentinel/bus-audit.sqlite3')
    loop = asyncio.new_event_loop()
    thread = Thread(target=loop.run_forever, daemon=True)
    thread.start()
    server = None
    try:
        asyncio.run_coroutine_threadsafe(gateway.start(), loop).result(10)
        gateway.work_sessions = WorkSessionManager(gateway, data / 'work-sessions',
                                                    python_runner=WslPythonRunner.configured())
        server = CouncilHTTPServer(('127.0.0.1', 0), handler(workers['architect'], token, gateway))
        server_thread = Thread(target=server.serve_forever, daemon=True)
        server_thread.start()
        BASE_URL = 'http://127.0.0.1:' + str(server.server_port)
        print(json.dumps({'mode': 'isolated_live_acceptance', 'runtime': WorkSessionManager.RUNTIME_REVISION,
                          'data_root': str(data)}), flush=True)
        yield data
    finally:
        if server is not None:
            server.shutdown()
            server.server_close()
            server_thread.join(5)
        if hasattr(gateway, 'work_sessions'):
            asyncio.run_coroutine_threadsafe(gateway.work_sessions.stop(), loop).result(30)
        asyncio.run_coroutine_threadsafe(gateway.stop(), loop).result(15)
        loop.call_soon_threadsafe(loop.stop)
        thread.join(5)
        if previous_data is None:
            os.environ.pop('NORI_DATA_ROOT', None)
        else:
            os.environ['NORI_DATA_ROOT'] = previous_data
        BASE_URL = previous_url


def read_receipt(store, state, index):
    previews = state.get("executions", [])
    if type(index) is not int or not 1 <= index <= len(previews):
        raise ValueError("A matching real execution index is missing")
    preview = previews[index - 1]
    path = store / "executions" / state["task_id"] / f"{index:03d}.json"
    raw = path.read_bytes()
    digest = hashlib.sha256(raw).hexdigest()
    if digest != preview.get("output_sha256"):
        raise ValueError("Durable execution output does not match its saved hash")
    receipt = json.loads(raw)
    if (receipt.get("status") != "completed" or receipt.get("executed") is not True
            or type(receipt.get("exit_code")) is not int or receipt["exit_code"] != 0
            or receipt.get("path") != preview.get("path")):
        raise ValueError("Isolated execution did not succeed")
    lines = receipt.get("stdout", "").strip().splitlines()
    if not lines:
        raise ValueError("Actual invocation output is missing")
    result = json.loads(lines[-1])
    counts = result.get("nori_skill_tests", {})
    keys = ("tests_run", "passed", "failures", "errors", "skipped",
            "expected_failures", "unexpected_successes")
    if (any(type(counts.get(key)) is not int or counts[key] < 0 for key in keys)
            or counts["tests_run"] < 3 or counts["passed"] < 3
            or counts["failures"] or counts["errors"] or counts["unexpected_successes"]
            or counts["tests_run"] != counts["passed"] + counts["skipped"] + counts["expected_failures"]):
        raise ValueError("The real invocation must run at least three passing tests")
    return receipt, result, digest, path


def check_evidence(store, task_id, skill, parameters, expected, *, source_task_id=None):
    """Read durable state, never the model's summary, to establish success."""
    if not re.fullmatch(r"[a-f0-9]{32}", task_id):
        raise ValueError("Invalid task identifier from the local service")
    state_path = store / (task_id + ".json")
    state = json.loads(state_path.read_text(encoding="utf-8"))
    if state.get("task_id") != task_id or state.get("status") != "completed":
        raise ValueError("The durable task did not complete")
    operations = state.get("executed_tools", [])
    invocations = [item for item in operations
                   if item.get("operation") == "run_capability"
                   and item.get("name") == skill and item.get("capability") == skill
                   and item.get("status") == "completed" and item.get("executed") is True
                   and type(item.get("exit_code")) is int and item["exit_code"] == 0
                   and item.get("parameters") == parameters]
    if not invocations:
        raise ValueError("A matching successful run_capability operation is missing")
    invocation = invocations[-1]
    source = source_task_id or task_id
    if invocation.get("source_task_id") != source:
        raise ValueError("Invocation did not use the expected newly created capability")
    receipt, result, digest, receipt_path = read_receipt(store, state, invocation.get("execution_index"))
    if (receipt.get("path") != f"active_capabilities/{skill}/_invoke.py"
            or receipt.get("arguments", []) != []
            or invocation.get("output_sha256") != digest):
        raise ValueError("Invocation receipt is not bound to the matching capability operation")
    snapshots = receipt.get("snapshot_manifest", [])
    hashes = {item.get("path"): item.get("sha256") for item in snapshots}
    expected_hashes = invocation.get("invocation_hashes", {})
    if (len(hashes) != len(snapshots) or len(expected_hashes) != 4
            or not all(hashes.get(path) == value for path, value in expected_hashes.items())):
        raise ValueError("Invocation receipt does not cover all exact capability files")
    actual = result.get("result")
    if type(actual) not in {int, float} or actual != expected or invocation.get("result") != actual:
        raise ValueError("Actual runner stdout did not return the expected numeric result")
    if invocation.get("test_counts") != result["nori_skill_tests"]:
        raise ValueError("Test metadata does not match actual runner stdout")

    source_path = store / (source + ".json")
    source_state = state if source == task_id else json.loads(source_path.read_text(encoding="utf-8"))
    active = next((item for item in source_state.get("activated_capabilities", [])
                   if item.get("name") == skill and item.get("capability") == skill
                   and item.get("task_id") == source and item.get("status") == "active_for_task"), None)
    if not active or active.get("hashes") != invocation.get("hashes"):
        raise ValueError("A matching active capability with the tested implementation is missing")
    test_receipt, tests, test_digest, test_path = read_receipt(store, source_state, active.get("test_execution"))
    if (active.get("test_output_sha256") != test_digest
            or test_receipt.get("path") != f"skills/{skill}/_verify.py"):
        raise ValueError("Activation is not bound to its real passing test receipt")
    acquisition = next((item for item in source_state.get("capability_acquisitions", [])
                        if item.get("capability") == skill and item.get("implementation") == skill
                        and item.get("status") == "original_goal_retried"
                        and item.get("original_goal") == source_state.get("goal")), None)
    if not acquisition:
        raise ValueError("The original acquisition goal was not verifiably retried")
    if source == task_id and acquisition.get("result_execution") != invocation.get("execution_index"):
        raise ValueError("Acquisition points to a different invocation")
    if source_task_id:
        if any(item.get("operation") == "create_skill_candidate" for item in operations):
            raise ValueError("The reuse task rebuilt a skill instead of reusing it")
        if not any(item.get("operation") == "find_skills" and item.get("matches", 0) > 0
                   for item in operations):
            raise ValueError("The reuse task did not discover the saved capability")

    return {"state_file": str(state_path), "source_task_id": source,
            "invocation_file": str(receipt_path), "invocation_sha256": digest,
            "activation_test_file": str(test_path), "activation_test_sha256": test_digest,
            "parameters": parameters, "expected": expected, "actual": actual,
            "test_counts": result["nori_skill_tests"], "activation_test_counts": tests["nori_skill_tests"],
            "invocation": invocation, "activation": active, "acquisition": acquisition,
            "operations": [item.get("operation") for item in operations]}


def run_case(token, store, conversation, skill, name, goal, parameters, expected, timeout,
             *, source_task_id=None):
    started = time.monotonic()
    state = request("/work", token, {"goal": goal, "conversation_id": conversation,
                                     "request_id": uuid4().hex})
    task_id = state["task_id"]
    case = {"name": name, "task_id": task_id, "goal": goal, "passed": False}
    print(json.dumps({"case": name, "task_id": task_id, "status": "started"}), flush=True)
    last_progress = None
    last_print = started
    try:
        while state.get("status") not in TERMINAL:
            if time.monotonic() - started > timeout:
                request(f"/work/{task_id}/cancel", token, {})
                case.update(status="timed_out", error="Deadline reached; cancellation requested")
                return case
            progress = (state.get("status"), len(state.get("executed_tools", [])),
                        len(state.get("executions", [])))
            if progress != last_progress and time.monotonic() - last_print >= 15:
                print(json.dumps({"case": name, "status": progress[0],
                                  "tool_operations": progress[1], "executions": progress[2]}), flush=True)
                last_progress, last_print = progress, time.monotonic()
            time.sleep(2)
            state = request(f"/work/{task_id}", token)
        case["status"] = state.get("status")
        case["evidence"] = check_evidence(store, task_id, skill, parameters, expected,
                                           source_task_id=source_task_id)
        case["passed"] = True
    except KeyboardInterrupt:
        request(f"/work/{task_id}/cancel", token, {})
        raise
    except Exception as error:
        # Never include request/header representations, which could expose auth.
        case.update(error_type=type(error).__name__, error=str(error).replace(token, "[redacted]"))
        if state.get("status") not in TERMINAL:
            try:
                request(f"/work/{task_id}/cancel", token, {})
                case["cancellation_requested"] = True
            except Exception:
                case["cancellation_requested"] = False
    finally:
        case["duration_seconds"] = round(time.monotonic() - started, 2)
    return case


def run(output, timeout=600, data_root=None):
    data = Path(data_root or os.environ.get("NORI_DATA_ROOT", ROOT / "runtime-data"))
    token = (data / "secrets/council-token").read_text(encoding="utf-8").strip()
    store = data / "work-sessions"
    conversation = str(uuid4())
    skill = "shipping-total-" + uuid4().hex[:12]
    report = {"schema": "nori.capability-acceptance.v1", "started_at": time.time(),
              "scope": "Live isolated Python capability creation, activation, invocation, and later reuse.",
              "conversation_id": conversation, "skill": skill, "passed": False, "cases": []}
    write_report(output, report)
    first_goal = (
        f"Create a brand new reusable Python capability named {skill}, with capability identifier {skill}. "
        "It calculates a shipping total from a JSON object: base + weight * rate, returning only a number. "
        "Reject negative weight with ValueError. Write three separate unittest test cases that call run with "
        "JSON-object-shaped requests: base=4.5, weight=3, rate=1.25 returns 8.25; base=4.5, weight=0, "
        "rate=1.25 returns 4.5; and negative weight raises ValueError. Run the actual tests, activate the "
        "tested capability, then invoke it using run_capability for my original input "
        '{"base":4.5,"weight":3,"rate":1.25}. Return the actual invocation result. '
        "Finish only after that invocation succeeds. No software installation or project publication is needed."
    )
    first = run_case(token, store, conversation, skill, "create_activate_invoke", first_goal,
                     {"base": 4.5, "weight": 3, "rate": 1.25}, 8.25, timeout)
    report["cases"].append(first)
    write_report(output, report)
    print(json.dumps({"case": first["name"], "passed": first["passed"],
                      "status": first.get("status"), "error": first.get("error")}), flush=True)
    if first["passed"]:
        second_goal = (
            "Find the shipping-total capability you just created earlier in this conversation using find_skills. "
            "Reuse that exact saved capability with run_capability for "
            '{"base":2,"weight":4,"rate":2}. Do not create another skill or write a new implementation. '
            "Return the actual result from invoking the saved capability and its test results."
        )
        second = run_case(token, store, conversation, skill, "discover_reuse", second_goal,
                          {"base": 2, "weight": 4, "rate": 2}, 10, timeout,
                          source_task_id=first["task_id"])
        report["cases"].append(second)
        print(json.dumps({"case": second["name"], "passed": second["passed"],
                          "status": second.get("status"), "error": second.get("error")}), flush=True)
    report["passed"] = len(report["cases"]) == 2 and all(case["passed"] for case in report["cases"])
    report["finished_at"] = time.time()
    write_report(output, report)
    print(json.dumps({"passed": report["passed"], "evidence_file": str(output)}), flush=True)
    return report["passed"]


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=ROOT / "runtime-data/capability-acceptance.json")
    parser.add_argument("--timeout", type=int, default=600, help="Maximum seconds for each of the two tasks")
    parser.add_argument("--data-root", type=Path, default=None)
    parser.add_argument('--isolated', action='store_true',
                        help='Use current code with separate state and an ephemeral HTTP port; leave the running app unchanged')
    args = parser.parse_args()
    if args.timeout < 1:
        parser.error("--timeout must be positive")
    if args.isolated:
        with isolated_runtime() as data:
            passed = run(args.output, args.timeout, data)
    else:
        passed = run(args.output, args.timeout, args.data_root)
    raise SystemExit(0 if passed else 1)
