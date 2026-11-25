"""Real standard launcher/graceful shutdown check. Uses its own ephemeral key."""
import http.client
import json
import os
from pathlib import Path
import secrets
import socket
import subprocess
import sys
import time
import asyncio
import tempfile
import threading
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from core_client import NativeInferenceClient, NativeInferenceCancelled
from types import SimpleNamespace

root = Path(__file__).resolve().parents[3]
port = 11435
with socket.socket() as check:
    if check.connect_ex(("127.0.0.1", port)) == 0:
        raise RuntimeError("runtime port already occupied;not replacing/restarting it")
key = secrets.token_urlsafe(32)
process = subprocess.Popen([sys.executable, "-B", str(root / "runtime/norllama/norllama.py")],
                           cwd=str(root), env={**os.environ, "NORI_RUNTIME_API_KEY": key},
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                           creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))

def call(path, body=None):
    connection = http.client.HTTPConnection("127.0.0.1", port, timeout=10)
    headers = {"Authorization": "Bearer " + key, "Content-Type": "application/json"}
    connection.request("GET" if body is None else "POST", path, body=None if body is None else json.dumps(body), headers=headers)
    response = connection.getresponse()
    result = response.status, json.loads(response.read())
    connection.close()
    return result

try:
    deadline = time.monotonic() + 30
    while True:
        if process.poll() is not None:
            raise AssertionError("normal runtime launcher exited before readiness")
        try:
            status, health = call("/health")
            if status == 200 and health["ready"]:
                break
        except (OSError, http.client.HTTPException):
            pass
        if time.monotonic() >= deadline:
            raise TimeoutError("normal launcher readiness deadline exceeded")
        time.sleep(0.1)
    status, answer = call("/v1/chat", {"model_id": "llama3.2-3b-instruct",
                         "messages": [{"role": "user", "content": "Say hello."}], "max_tokens": 4, "stream": False})
    assert status == 200 and answer["text"] == "Hello!", (status, answer)
    native_client = NativeInferenceClient(f'http://127.0.0.1:{port}', key, 'llama3.2-3b-instruct')
    assert native_client.health()['ready'] is True
    core_answer = native_client.generate([{'role': 'user', 'content': 'Say hello.'}], 4)
    assert core_answer['text'] == 'Hello!' and core_answer['fallback'] is False
    cancelled = threading.Event()
    cancel_timer = threading.Timer(0.2, cancelled.set)
    cancel_timer.start()
    try:
        native_client.generate([{'role': 'user', 'content': 'Write a long numbered list from one to one thousand.'}],
                               2048, cancel_event=cancelled)
    except NativeInferenceCancelled:
        pass
    else:
        raise AssertionError('native client cancellation did not interrupt generation')
    finally:
        cancel_timer.cancel()
        cancel_timer.join()
    assert native_client.generate([{'role': 'user', 'content': 'Say hello.'}], 4)['text'] == 'Hello!'
    sys.path.insert(0, str(root / 'nori'))
    from native_inference import configure_native_inference
    core_config = json.loads((root / 'nori/config.yaml').read_text(encoding='utf-8'))
    core_config['native_inference'] = {'model_id': 'llama3.2-3b-instruct',
                                     'assignments': {name: 'llama3.2-3b-instruct' for name in core_config['knights']}}
    native_client = configure_native_inference(core_config,
                    {'NORI_INFERENCE_RUNTIME': 'norllama', 'NORI_RUNTIME_URL': f'http://127.0.0.1:{port}',
                     'NORI_RUNTIME_API_KEY': key})
    from machine_transport import generate
    worker = SimpleNamespace(endpoint=f'http://127.0.0.1:{port}', knight='architect',
                             spec={'model': 'llama3.2-3b-instruct', 'options': {'num_predict': 4}},
                             prompt='Be concise.', native_inference=native_client)
    transport_answer = generate(worker, 'Say hello.')
    assert transport_answer['status'] == 'completed' and transport_answer['executed_tools'] == []
    assert transport_answer['inference']['backend'] == 'norama-independent'
    assert transport_answer['response'].strip()
    for kwargs in [{'scheduler': object()}, {'review_source': 'x = 1'}]:
        try:
            generate(worker, 'Say hello.', **kwargs)
        except ValueError:
            pass
        else:
            raise AssertionError('native transport accepted unqualified legacy scheduling/review')
    # Real Sentinel/bus/Machine route with an isolated audit database. No tool
    # grants, model substitutions, legacy scheduler or production state.
    from council_gateway import CouncilGateway
    from bus import AgentName
    async def check_async_cancellation():
        test_worker = SimpleNamespace(endpoint=native_client.endpoint, knight='architect', prompt='Be concise.',
                                      spec={'model': native_client.model_id, 'options': {'num_predict': 2048}},
                                      native_inference=native_client)
        test_gateway = object.__new__(CouncilGateway)
        pending = asyncio.create_task(test_gateway.generate_inference(test_worker,
                                      'Write a long numbered list from one to one thousand.'))
        try:
            deadline = time.monotonic() + 5
            while True:
                _, active = await asyncio.to_thread(call, '/health')
                if active.get('active_request_id'): break
                if pending.done() or time.monotonic() >= deadline:
                    raise AssertionError('real async inference did not become active')
                await asyncio.sleep(0.02)
            pending.cancel()
            try: await pending
            except asyncio.CancelledError: pass
            else: raise AssertionError('Core async cancellation was not preserved')
        finally:
            if not pending.done():
                pending.cancel()
                try: await pending
                except asyncio.CancelledError: pass
    asyncio.run(check_async_cancellation())
    assert native_client.generate([{'role': 'user', 'content': 'Say hello.'}], 4)['text'] == 'Hello!'
    worker.runtime = SimpleNamespace()
    machine = SimpleNamespace(knight='machine', runtime=SimpleNamespace())
    async def check_gateway(audit_path, workers=None):
        gateway = CouncilGateway(workers or {'architect': worker, 'machine': machine}, key, audit_path)
        await gateway.start()
        try:
            try:
                await gateway.request(AgentName.MACHINE, 'infer',
                                      {'goal': 'Say hello.', 'knight': 'architect'}, 'invalid', sender=AgentName.ARCHITECT)
            except PermissionError:
                pass
            else:
                raise AssertionError('Sentinel accepted invalid credentials')
            answer = await gateway.request(AgentName.MACHINE, 'infer',
                                           {'goal': 'Say hello.', 'knight': 'architect'}, key, sender=AgentName.ARCHITECT)
            assert answer['status'] == 'completed' and answer['executed_tools'] == []
            assert answer['inference']['backend'] == 'norama-independent' and answer['response'].strip()
            # Exercise cancellation through the actual bus request, not only
            # the generation helper. A following request must reuse the worker.
            target = gateway.workers['architect']
            previous_options = target.spec.get('options', {}).copy()
            target.spec['options'] = {**previous_options, 'num_predict': 2048}
            pending = asyncio.create_task(gateway.request(AgentName.MACHINE, 'infer',
                {'goal': 'Write a long numbered list from one to one thousand.', 'knight': 'architect'},
                key, sender=AgentName.ARCHITECT))
            try:
                deadline = time.monotonic() + 10
                while True:
                    _, active = await asyncio.to_thread(call, '/health')
                    if active.get('active_request_id'): break
                    if pending.done() or time.monotonic() >= deadline:
                        raise AssertionError('bus inference never became active')
                    await asyncio.sleep(0.02)
                pending.cancel()
                try: await pending
                except asyncio.CancelledError: pass
                else: raise AssertionError('bus request cancellation was lost')
                await asyncio.sleep(0)
                assert not gateway.pending and not gateway.request_jobs
            finally:
                target.spec['options'] = previous_options
                if not pending.done():
                    pending.cancel()
                    await asyncio.gather(pending, return_exceptions=True)
            reused = await gateway.request(AgentName.MACHINE, 'infer',
                {'goal': 'Say hello.', 'knight': 'architect'}, key, sender=AgentName.ARCHITECT)
            assert reused['status'] == 'completed' and reused['response'].strip()
            assert call('/health')[1]['worker_pid'] == health['worker_pid']
        finally:
            await gateway.stop()
    with tempfile.TemporaryDirectory(prefix='.native-core-probe-', dir=root / 'verification') as state:
        asyncio.run(check_gateway(Path(state) / 'audit.sqlite3'))
    with tempfile.TemporaryDirectory(prefix='.native-workers-probe-', dir=root / 'verification') as state:
        from main import Worker, handler, CouncilHTTPServer
        previous_data = os.environ.get('NORI_DATA_ROOT')
        os.environ['NORI_DATA_ROOT'] = state
        try:
            real_workers = {name: Worker(core_config, name, native_client) for name in core_config['startup_order']}
            assert len(real_workers) == 12
            assert all(item.native_inference is native_client for item in real_workers.values())
            assert all(item.spec['model'] == native_client.model_id for item in real_workers.values())
            assert all(item.endpoint == native_client.endpoint for item in real_workers.values())
            architect = real_workers['architect']
            architect.spec['options'] = {**architect.spec.get('options', {}), 'num_predict': 4}
            actual_prompt_answer = generate(architect, 'Say hello.')
            assert actual_prompt_answer['status'] == 'completed' and actual_prompt_answer['response'].strip()
            asyncio.run(check_gateway(Path(state) / 'native-bus-audit.sqlite3', real_workers))
            listeners = []
            try:
                for name, item in real_workers.items():
                    listener = CouncilHTTPServer(('127.0.0.1', 0), handler(item, key))
                    thread = threading.Thread(target=listener.serve_forever, kwargs={'poll_interval': 0.05})
                    thread.start()
                    listeners.append((listener, thread))
                    def route(headers):
                        connection = http.client.HTTPConnection('127.0.0.1', listener.server_port, timeout=5)
                        try:
                            connection.request('GET', '/health', headers=headers)
                            response = connection.getresponse()
                            return response.status, json.loads(response.read())
                        finally: connection.close()
                    assert route({})[0] == 401
                    assert route({'Authorization': 'Bearer ' + key, 'Host': 'untrusted.example'})[0] == 403
                    status, route_health = route({'Authorization': 'Bearer ' + key})
                    assert status == 200 and route_health['knight'] == name and route_health['model_ready'] is True
                assert len(listeners) == 12
            finally:
                for listener, thread in reversed(listeners):
                    listener.shutdown()
                    listener.server_close()
                    thread.join(timeout=5)
                    assert not thread.is_alive()
            from core_lifecycle import initialize_core_services, close_core_services
            auxiliary_config = {**core_config, 'sensors': []}  # Do not capture owner devices in a lifecycle test.
            auxiliary_gateway = CouncilGateway(real_workers, key, Path(state) / 'auxiliary-audit.sqlite3')
            auxiliary_loop = asyncio.new_event_loop()
            auxiliary_thread = threading.Thread(target=auxiliary_loop.run_forever)
            auxiliary_thread.start()
            sensory = None
            try:
                sensory = initialize_core_services(auxiliary_config, auxiliary_gateway, key,
                                                   auxiliary_loop, Path(state) / 'auxiliary')
                sensory.start()
                asyncio.run_coroutine_threadsafe(auxiliary_gateway.proactive_routines.start(), auxiliary_loop).result(5)
                assert sensory.status()['running'] is True and sensory.status()['configured_count'] == 0
            finally:
                failures = close_core_services(auxiliary_loop, auxiliary_thread, auxiliary_gateway, [], sensory)
                assert failures == [], failures
        finally:
            if previous_data is None: os.environ.pop('NORI_DATA_ROOT', None)
            else: os.environ['NORI_DATA_ROOT'] = previous_data
    core_probe = subprocess.run(
        [sys.executable, '-B', str(root / 'runtime/norllama/tests/actual_core_process_probe.py')],
        cwd=str(root), env={**os.environ, 'NORI_TEST_ENDPOINT': f'http://127.0.0.1:{port}', 'NORI_TEST_KEY': key},
        capture_output=True, text=True, timeout=100, creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
    if core_probe.returncode != 0:
        raise AssertionError('supervised Core process probe failed: ' + core_probe.stderr[-2000:])
    print(core_probe.stdout.strip())
    desktop_probe = subprocess.run(
        ['node', str(root / 'runtime/norllama/tests/actual_desktop_client_probe.mjs')],
        cwd=str(root), env={**os.environ, 'NORI_TEST_ENDPOINT': f'http://127.0.0.1:{port}',
                           'NORI_TEST_KEY': key}, capture_output=True, text=True, timeout=120,
        creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
    if desktop_probe.returncode != 0:
        raise AssertionError('desktop native transport probe failed: ' + desktop_probe.stderr[-2000:])
    desktop_result = json.loads(desktop_probe.stdout.strip().splitlines()[-1])
    assert desktop_result['active_abort_and_quiescence'] == 'PASS'
    assert call('/health')[1]['worker_pid'] == health['worker_pid']
    print(json.dumps(desktop_result))
    assert call("/v1/shutdown", {}) == (200, {"shutdown": True})
    assert process.wait(timeout=10) == 0
    print(json.dumps({"normal_cli": "PASS", "authenticated_port": port, "backend": health["backend"],
                      "runtime_pid": process.pid, "worker_pid": health["worker_pid"],
                      "real_text": answer["text"], "native_core_client": "PASS", "core_async_cancellation": "PASS", "core_client_cancellation_reuse": "PASS", "core_boot_preflight": "PASS", "twelve_real_workers": "PASS", "twelve_native_http_routes": "PASS", "auxiliary_lifecycle_no_capture": "PASS", "production_architect_prompt": "PASS", "real_workers_sentinel_bus": "PASS", "machine_transport": "PASS", "sentinel_native_inference": "PASS", "graceful_shutdown": "PASS", "runtime_exit": process.returncode}))
finally:
    if process.poll() is None:
        try:
            call("/v1/shutdown", {})
            process.wait(timeout=5)
        except Exception:
            # Only this known owned runtime process tree,never other Nori/services.
            subprocess.run([str(Path(os.environ["SystemRoot"]) / "System32/taskkill.exe"), "/PID", str(process.pid), "/T", "/F"],
                           capture_output=True, timeout=10, creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
            process.wait(timeout=5)
