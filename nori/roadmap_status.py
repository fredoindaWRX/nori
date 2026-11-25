"""Deterministic evidence map for the current Nori platform (Workspace + Council).

Default inspection is file/test based and does not run active checks. Explicit
run_checks requests retain historical verifier behavior (including network or
temporary fixture activity); they are not whole-system acceptance evidence.
No LLM is asked to infer completion and personal memory is never probed here.
"""
from __future__ import annotations

from pathlib import Path
import json
from typing import Callable


ROOT = Path(r"C:\Nori")

_EVIDENCE = {
    # Current platform surfaces. Relative paths resolve against the repo root
    # (implementation) or tests/; absolute paths are used exactly as given.
    "voice_pipeline": (("speech.py", "voice.py", "voice_identity_runtime_v1.py"), ("test_nori_voice_latency_contract.py", "test_nori_barge_in.py")),
    "memory_context": (("memory_v2.py",), ("test_nori_memory_evidence.py",)),
    "runtime_health": (("system_agent.py", "health_bridge.py"), ("test_nori_runtime_health_contract.py", "test_nori_health_bridge_security.py")),
    "device_surfaces": (("device_surface_catalog.py", "device_hal.py"), ("test_nori_device_surface_catalog_contract.py",)),
    "safety_boundaries": (("aoki_twin/contracts.py", "device_control_leases.py"), ("test_reasoning_boundary.py", "test_leased_device_adapter.py")),
    "research": (("internet_research.py", "research_worker.py"), ("test_research_recheck.py",)),
    "learning": (("learning_director.py", "learning_goals.py"), ("test_learning_goals.py",)),
    "notifications": (("notification_router.py",), ("test_notification_router.py",)),
    "portable_usb": (("nori/portable_manifest.py", "launcher.py", "requirements.txt"), ("test_nori_portable_manifest.py",)),
    "remote_mesh": (("node_mesh_client.py", "node_mesh_contract.py"), ("test_remote_device_control.py",)),
    "vehicle_node": (("vehicle_node.py", "device_surface_catalog.py", "node_mesh_contract.py"), ("test_nori_vehicle_node.py",)),
    "recovery": (("nori/recovery.py",), ("test_nori_recovery.py",)),
    "dependency_manager": (("nori/deps/manager.py", "nori/deps/allowlist.yaml"), ("test_nori_dependency_manager.py",)),
    "workspace_operator": (("nori/workspace_operator.py", "local_ai_teammate_team.py", "coding_worker.py"), ("test_nori_workspace_operator.py",)),
    "internet_authority": (("nori/internet_authority.py", "nori/deps/manager.py", "nori/deps/allowlist.yaml"), ("test_nori_internet_authority.py",)),
    "workspace_bridge": (("workspace/server.py", "workspace/static/index.html"), (r"C:\Nori\workspace\test_server.py", r"C:\Nori\workspace\test_outputs.py")),
    "council_gateway": (("nori/council_gateway.py", "nori/bus.py", "nori/work_sessions.py"), (r"C:\Nori\nori\tests_startup\test_gateway.py", r"C:\Nori\nori\tests_startup\test_bus.py", r"C:\Nori\nori\tests_startup\test_work_sessions.py")),
    "desktop_release_manifest": (("verify_nori_desktop_release.py", "nori-desktop-release-manifest.json"), ("test_nori_desktop_release_validator.py",)),
}


def _verify_runtime_health() -> tuple[bool, str]:
    try:
        from system_agent import snapshot

        result = snapshot()
    except Exception as exc:
        return False, f"health snapshot failed: {exc}"
    health = result.get("health") if isinstance(result, dict) else {}
    status = health.get("status") if isinstance(health, dict) else None
    if result.get("success") is True and status in {"HEALTHY", "ATTENTION"}:
        return True, f"system snapshot returned {status}"
    return False, f"system snapshot status={status}"


def _source_revision(path: Path, constant: str, *, owning_class: str | None = None) -> str | None:
    """Read a service revision without importing the module that owns it."""
    import ast

    try:
        tree = ast.parse(path.read_text(encoding="utf-8-sig"), filename=str(path))
    except (OSError, SyntaxError, UnicodeError):
        return None
    candidates = tree.body
    if owning_class is not None:
        for node in tree.body:
            if isinstance(node, ast.ClassDef) and node.name == owning_class:
                candidates = node.body
                break
        else:
            return None
    for node in candidates:
        if not isinstance(node, ast.Assign):
            continue
        if not any(isinstance(target, ast.Name) and target.id == constant for target in node.targets):
            continue
        if isinstance(node.value, ast.Constant) and isinstance(node.value.value, str):
            return node.value.value
    return None


def _verify_workspace_bridge() -> tuple[bool, str]:
    """Probe the live Workspace bridge against its verified source revision.

    This replaces the retired native-desktop install check: the surface the
    owner actually runs is the Workspace bridge.
    """
    import urllib.request

    expected = _source_revision(ROOT / "workspace" / "server.py", "BRIDGE_REVISION")
    if expected is None:
        return False, "workspace bridge source revision is missing"
    try:
        with urllib.request.urlopen("http://127.0.0.1:9444/api/status", timeout=2) as response:
            payload = json.loads(response.read().decode("utf-8"))
    except Exception as exc:
        return False, f"workspace bridge unreachable: {type(exc).__name__}"
    live = payload.get("bridge_revision")
    if live == expected and payload.get("connected") is True:
        return True, f"workspace bridge revision {live} is live and connected to Council"
    return False, (
        f"workspace bridge revision live={live} expected={expected} "
        f"connected={payload.get('connected')}"
    )


def _verify_council_gateway() -> tuple[bool, str]:
    """Probe the live Council and compare its work runtime with source."""
    import urllib.request

    expected = _source_revision(
        ROOT / "nori" / "work_sessions.py", "RUNTIME_REVISION", owning_class="WorkSessionManager"
    )
    if expected is None:
        return False, "council work runtime source revision is missing"
    try:
        with urllib.request.urlopen("http://127.0.0.1:9107/health", timeout=2) as response:
            payload = json.loads(response.read().decode("utf-8"))
    except Exception as exc:
        return False, f"council listener unreachable: {type(exc).__name__}"
    runtime = payload.get("work_runtime")
    live = runtime.get("revision") if isinstance(runtime, dict) else None
    if live == expected and payload.get("model_ready") is True:
        return True, f"council work runtime revision {live} is live with its model ready"
    return False, (
        f"council work runtime revision live={live} expected={expected} "
        f"model_ready={payload.get('model_ready')}"
    )


def _verify_desktop_release_manifest() -> tuple[bool, str]:
    try:
        from verify_nori_desktop_release import verify
        result = verify(ROOT)
    except Exception as exc:
        return False, f"desktop release manifest failed: {type(exc).__name__}: {exc}"
    if result.get('status') == 'verified' and result.get('file_count', 0) >= 1:
        revisions = result.get('revisions', {})
        return True, (f"verified {result['file_count']} immutable NORI desktop files; "
                      f"workspace={revisions.get('workspace')} council={revisions.get('council')}")
    return False, 'desktop release manifest did not return verified status'


def _verify_memory_context() -> tuple[bool, str]:
    # Status inspection is not consent to mutate personal memory. The old
    # marker write/delete also depended on retired memory_v2/cortana_core_db.
    # Isolated native tests prove their tested scope, not live owner readiness.
    return False, ("Active personal memory is not probed by roadmap inspection; "
                   "use isolated native memory and Core integration evidence, "
                   "then qualify live integration separately")


def _verify_device_surfaces() -> tuple[bool, str]:
    try:
        from device_surface_catalog import required_capabilities

        pc = set(required_capabilities("pc"))
        phone = set(required_capabilities("phone"))
        camera = set(required_capabilities("webcam"))
    except Exception as exc:
        return False, f"surface catalog failed: {exc}"
    if {"microphone", "speaker", "voice_input", "voice_output"}.issubset(pc) and {"notifications", "camera"}.issubset(phone) and "vision" in camera:
        return True, "pc, phone, speaker, and camera capability contracts resolved"
    return False, "required device capabilities missing"


def _verify_safety_boundaries() -> tuple[bool, str]:
    try:
        from device_control_leases import DeviceControlLeases
        from remote_device_control import run_trusted_remote_command
        import tempfile

        with tempfile.TemporaryDirectory() as temporary:
            leases = DeviceControlLeases(Path(temporary) / "leases.json")
            leases.emergency_stop()
            result = run_trusted_remote_command(
                "phone-1",
                "hardware_status",
                trusted=True,
                runner=lambda _command: {"success": True},
                leases=leases,
            )
    except Exception as exc:
        return False, f"safety contract failed: {exc}"
    if result.get("error") == "emergency_stop_active":
        return True, "emergency-stop latch blocks trusted remote commands"
    return False, f"unexpected safety result={result}"


def _verify_voice_pipeline() -> tuple[bool, str]:
    try:
        import nori_barge_in

        samples = [
            nori_barge_in.BargeInSample(latency_ms=8.0 + (index % 7), cancelled=True)
            for index in range(50)
        ]
        contract_ok = nori_barge_in.barge_in_contract_passes(samples)
        voice_source = (ROOT / "voice.py").read_text(encoding="utf-8-sig")
        speech_source = (ROOT / "speech.py").read_text(encoding="utf-8-sig")
    except Exception as exc:
        return False, f"voice contract failed: {exc}"
    constants_ok = all(
        text in voice_source
        for text in ("WAKE_CHUNK_SECONDS = 2", "END_SILENCE_SECONDS = 0.55", "MIN_VOICE_SECONDS = 0.20")
    )
    wake_ack_ok = 'WAKE_ACKNOWLEDGEMENT = "Yeah?"' in speech_source and "preload_wake_acknowledgement" in speech_source
    if contract_ok and constants_ok and wake_ack_ok:
        return True, "wake latency constants, fixed acknowledgement preload, and barge-in contract passed"
    return False, "voice latency or barge-in contract missing"


def _verify_remote_mesh() -> tuple[bool, str]:
    try:
        from device_control_leases import DeviceControlLeases
        from remote_device_control import run_trusted_remote_command
        import tempfile

        with tempfile.TemporaryDirectory() as temporary:
            calls = []
            result = run_trusted_remote_command(
                "phone-1",
                "hardware_status",
                trusted=True,
                runner=lambda command: calls.append(command) or {"success": True, "cpu": 10},
                leases=DeviceControlLeases(Path(temporary) / "leases.json"),
            )
    except Exception as exc:
        return False, f"remote mesh contract failed: {exc}"
    if result.get("success") is True and result.get("verified") is True and calls == ["hardware_status"]:
        return True, "trusted remote command lease/readback path passed"
    return False, f"unexpected remote mesh result={result}"


def _verify_vehicle_node() -> tuple[bool, str]:
    try:
        from device_surface_catalog import required_capabilities
        from vehicle_node import build_vehicle_node_profile, validate_vehicle_command, vehicle_node_handshake

        capabilities = set(required_capabilities("car"))
        profile = build_vehicle_node_profile("vehicle-roadmap", trusted=True)
        handshake = vehicle_node_handshake(profile)
        speak = validate_vehicle_command("speak", trusted=True)
        unsafe = validate_vehicle_command("steer", trusted=True)
    except Exception as exc:
        return False, f"vehicle node verifier failed: {exc}"
    required = {"microphone", "speaker", "voice_input", "voice_output", "bluetooth_audio", "location_hint", "diagnostics", "emergency_mute"}
    if required.issubset(capabilities) and handshake.get("accepted") is True and speak.get("allowed") is True and unsafe.get("error") == "unsafe_vehicle_control_blocked":
        return True, "vehicle node handshake, car audio bridge, and unsafe driving-command block passed"
    return False, "vehicle node contract did not pass"


def _verify_notifications() -> tuple[bool, str]:
    try:
        from notification_router import deliver

        calls = []
        result = deliver(
            [
                {"node_id": "good", "online": True, "capabilities": ["notifications"]},
                {"node_id": "bad", "online": True, "capabilities": ["notifications"]},
            ],
            "Nori verification",
            lambda node_id, message: calls.append((node_id, message)) or (False if node_id == "bad" else True),
        )
    except Exception as exc:
        return False, f"notification verifier failed: {exc}"
    if result.get("delivered") == ["good"] and result.get("failed") == [{"node_id": "bad", "error": "delivery_rejected"}]:
        return True, "notification routing and rejected-delivery accounting passed"
    return False, f"unexpected notification result={result}"


def _verify_portable_usb() -> tuple[bool, str]:
    try:
        from nori.portable_manifest import validate

        result = validate(ROOT)
    except Exception as exc:
        return False, f"portable manifest failed: {exc}"
    if result.get("ready") is True and result.get("missing") == []:
        return True, "portable runtime prerequisite manifest passed"
    return False, f"portable manifest missing={result.get('missing')}"


def _verify_recovery() -> tuple[bool, str]:
    try:
        from nori.recovery import load_checkpoint, save_checkpoint
        import tempfile

        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "checkpoint.json"
            save_checkpoint({"wake_name": "Nori", "mode": "verify"}, path)
            loaded = load_checkpoint(path)
            tampered = path.read_text(encoding="utf-8").replace('"verify"', '"tampered"')
            path.write_text(tampered, encoding="utf-8")
            closed = load_checkpoint(path)
    except Exception as exc:
        return False, f"recovery verifier failed: {exc}"
    if loaded == {"wake_name": "Nori", "mode": "verify"} and closed is None:
        return True, "checkpoint round-trip and tamper fail-closed passed"
    return False, "checkpoint verification did not round-trip/fail closed"


def _verify_learning() -> tuple[bool, str]:
    try:
        import learning_goals

        listed = learning_goals.list_learning_goals(status="active")
        chosen = learning_goals.choose_learning_goal()
    except Exception as exc:
        return False, f"learning verifier failed: {exc}"
    if listed.get("success") is True and listed.get("count", 0) >= 1 and isinstance(chosen, dict):
        return True, f"active learning goals available: {listed.get('count')}"
    return False, "no active learning goal available"


def _verify_research() -> tuple[bool, str]:
    try:
        import internet_research

        rejected_private = False
        try:
            internet_research._public_http_url("http://127.0.0.1:30120/info.json")
        except ValueError:
            rejected_private = True
        cleaned = internet_research._clean_research_query(
            "(site:learn.microsoft.com OR site:microsoft.com) Strengthen authoritative evidence for: Windows services"
        )
        domain_ok = internet_research._domain_allowed(
            "https://learn.microsoft.com/en-us/windows/win32/services/services",
            ["learn.microsoft.com", "microsoft.com"],
        )
    except Exception as exc:
        return False, f"research verifier failed: {exc}"
    if rejected_private and cleaned == "Windows services" and domain_ok:
        return True, "research URL safety, query cleaning, and authoritative domain policy passed"
    return False, "research safety/policy checks did not pass"


def _verify_dependency_manager() -> tuple[bool, str]:
    from nori.deps import DependencyManager
    result = DependencyManager(ROOT / "nori/deps/allowlist.yaml").check()
    return result["result"] == "PASS", str(result)


def _verify_workspace_operator() -> tuple[bool, str]:
    from nori.workspace_operator import create_workspace_task, operator_status
    result = operator_status()
    task = create_workspace_task("verify local pipeline", project_root=ROOT)
    evidence_path = ROOT / "docs" / "nori_local_team_live_smoke.json"
    try:
        evidence = json.loads(evidence_path.read_text(encoding="utf-8"))
    except Exception as exc:
        return False, f"workspace operator evidence unreadable: {type(exc).__name__}"
    stages = evidence.get("stages") or []
    stage_names = {str(row.get("role")) for row in stages if isinstance(row, dict) and row.get("success") is True}
    if result.get("ready") is True and task.get("routing", {}).get("mode") == "nori_local_first" and {"planner", "coder", "critic", "reviewer"}.issubset(stage_names) and evidence.get("success") is True and evidence.get("paid_inference_used") is False:
        return True, "workspace task routing and local planner/coder/critic/reviewer execution evidence passed"
    return False, f"workspace operator execution evidence incomplete: status={result}, stages={sorted(stage_names)}"


def _verify_internet_authority() -> tuple[bool, str]:
    from nori.internet_authority import authorize_internet_use
    result = authorize_internet_use("research", "Verify research authorization")
    if result.get("authorized") is not True:
        return False, "internet authorization denied: " + str(result)
    try:
        from internet_research import fetch_web_page
        page = fetch_web_page("https://example.com", timeout=8)
        if not isinstance(page, dict) or not page.get("text"):
            return False, "authorized internet request returned no text"
        return True, "authorized public-web fetch passed through Nori research policy"
    except Exception as exc:
        return False, f"authorized internet fetch failed: {type(exc).__name__}"


_RUNTIME_VERIFIERS: dict[str, Callable[[], tuple[bool, str]]] = {
    "voice_pipeline": _verify_voice_pipeline,
    "memory_context": _verify_memory_context,
    "runtime_health": _verify_runtime_health,
    "device_surfaces": _verify_device_surfaces,
    "safety_boundaries": _verify_safety_boundaries,
    "remote_mesh": _verify_remote_mesh,
    "vehicle_node": _verify_vehicle_node,
    "research": _verify_research,
    "learning": _verify_learning,
    "notifications": _verify_notifications,
    "portable_usb": _verify_portable_usb,
    "recovery": _verify_recovery,
    "dependency_manager": _verify_dependency_manager,
    "workspace_operator": _verify_workspace_operator,
    "internet_authority": _verify_internet_authority,
    "workspace_bridge": _verify_workspace_bridge,
    "council_gateway": _verify_council_gateway,
    "desktop_release_manifest": _verify_desktop_release_manifest,
}


def _exists(relative: str) -> bool:
    candidate = Path(relative)
    return (candidate if candidate.is_absolute() else ROOT / candidate).exists()


def _test_path(relative: str) -> Path:
    """Resolve test evidence; absolute paths are used exactly as given."""
    candidate = Path(relative)
    return candidate if candidate.is_absolute() else Path("tests") / candidate


def report(*, run_checks: bool = False) -> dict[str, object]:
    rows = []
    for name, (files, tests) in _EVIDENCE.items():
        present_files = [path for path in files if _exists(path)]
        present_tests = [path for path in tests if _exists(_test_path(path))]
        status = "EVIDENCED" if len(present_files) == len(files) and len(present_tests) == len(tests) else "INCOMPLETE"
        verified = False
        check_run = False
        verification_detail = "Active checks were not requested; source presence is not live readiness."
        verifier = _RUNTIME_VERIFIERS.get(name)
        if run_checks and status == "EVIDENCED" and verifier is not None:
            check_run = True
            verified, verification_detail = verifier()
        rows.append({
            "subsystem": name,
            "implementation_evidence": present_files,
            "test_evidence": present_tests,
            "verification_scope": "deterministic_verifier" if verifier is not None else "file_presence_only",
            "verification_detail": verification_detail,
            "deterministic_check_status": "PASS" if verified else "FAIL" if check_run else "NOT_RUN",
            # These verifiers include synthetic contracts and file checks.
            # None supplies a whole-system acceptance receipt.
            "end_to_end_status": "UNVERIFIED",
            "status": status,
        })
    evidenced = sum(row["status"] == "EVIDENCED" for row in rows)
    passed_checks = sum(row["deterministic_check_status"] == "PASS" for row in rows)
    return {
        "schema": "nori.roadmap.evidence.v1",
        "completion_proven": False,
        "verification_limit": "Deterministic checks report their narrow result separately; they do not establish end-to-end subsystem acceptance.",
        "end_to_end_summary": {"verified": 0, "unverified": len(rows)},
        "deterministic_check_summary": {"passed": passed_checks,
            "failed": sum(row["deterministic_check_status"] == "FAIL" for row in rows),
            "not_run": sum(row["deterministic_check_status"] == "NOT_RUN" for row in rows)},
        "summary": {"total": len(rows), "evidenced": evidenced, "incomplete": len(rows) - evidenced},
        "subsystems": rows,
    }


def write_report(path: Path | None = None, *, run_checks: bool = False) -> Path:
    """Write the current evidence report atomically and return its path."""
    target = Path(path or (ROOT / "health" / "nori_roadmap_evidence.json"))
    target.parent.mkdir(parents=True, exist_ok=True)
    temporary = target.with_suffix(target.suffix + ".tmp")
    temporary.write_text(json.dumps(report(run_checks=run_checks), indent=2), encoding="utf-8")
    temporary.replace(target)
    return target


if __name__ == "__main__":
    print(write_report())
