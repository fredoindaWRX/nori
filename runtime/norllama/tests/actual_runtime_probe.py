"""Explicit real GPU/model integration probe;not part of mock-only unit discovery."""
import http.client
import json
import os
from pathlib import Path
import secrets
import subprocess
import sys
import threading
import time
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import norllama as n

root = Path(__file__).resolve().parents[3]
model = root / "models/language/llama3.2-3b-instruct/llama3.2-3b-instruct.gguf"
binary = root / "engine/norama/norama-worker.exe"
start = time.perf_counter()
client = n.WorkerClient([str(binary), str(model)], root)
server = None
thread = None
try:
    startup = time.perf_counter() - start
    pid = client.process.pid
    key = secrets.token_urlsafe(32)  # Ephemeral integration key,never printed/stored.
    server = n.RuntimeServer(("127.0.0.1", 0), client, key, "llama3.2-3b-instruct")
    thread = threading.Thread(target=server.serve_forever, kwargs={"poll_interval": 0.05})
    thread.start()
    def call(path="/health", body=None, auth=True):
        connection = http.client.HTTPConnection("127.0.0.1", server.server_port, timeout=30)
        headers = {"Content-Type": "application/json"}
        if auth:
            headers["Authorization"] = "Bearer " + key
        connection.request("GET" if body is None else "POST", path, body=None if body is None else json.dumps(body), headers=headers)
        response = connection.getresponse()
        result = response.status, response.read()
        connection.close()
        return result
    assert call(auth=False)[0] == 401
    assert call()[0] == 200
    body = {"model_id": "llama3.2-3b-instruct", "messages": [{"role": "user", "content": "Say hello."}],
            "max_tokens": 4, "stream": False}
    first_start = time.perf_counter()
    status, result = call("/v1/chat", body)
    first_seconds = time.perf_counter() - first_start
    first = json.loads(result)
    assert status == 200 and first["text"] == "Hello!", (status, first)
    status, result = call("/v1/chat", body)
    assert status == 200 and json.loads(result)["text"] == "Hello!"
    assert client.process.pid == pid and client.health()["ready"]
    with client.request([{"role": "user", "content": "Write a long detailed story about space exploration."}], 200) as request:
        while True:
            kind, value = request.next()
            if kind == "token" and value:
                break
        cancel_start = time.perf_counter()
        assert client.cancel(request.id)
        try:
            while not request.complete:
                request.next()
        except n.RuntimeCancelled:
            cancel_seconds = time.perf_counter() - cancel_start
        else:
            raise AssertionError("real active cancellation was not observed")
    assert cancel_seconds < 3
    assert call("/v1/chat", body)[0] == 200
    node = Path(r"C:\Program Files\nodejs\node.exe")
    environment = {**os.environ, "NORI_TEST_ENDPOINT": f"http://127.0.0.1:{server.server_port}", "NORI_TEST_KEY": key}
    result = subprocess.run([str(node), str(Path(__file__).with_name("actual_desktop_client_probe.mjs"))],
                            env=environment, cwd=str(root), capture_output=True, text=True, timeout=60,
                            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
    assert result.returncode == 0, result.stderr
    assert client.process.pid == pid and client.health()["ready"]
    print(result.stdout.strip())
    if '--core-process' in sys.argv[1:]:
        core_result = subprocess.run([sys.executable, '-B',
            str(Path(__file__).with_name('actual_core_process_probe.py'))],
            env=environment, cwd=str(root), capture_output=True, text=True, timeout=90,
            creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
        assert core_result.returncode == 0, core_result.stderr
        assert client.process.pid == pid and client.health()['ready']
        print(core_result.stdout.strip())
    print(json.dumps({"real_runtime": "PASS", "worker_pid": pid, "same_worker_reused": True,
                      "startup_seconds": startup, "first_http_seconds": first_seconds,
                      "real_cancel_seconds": cancel_seconds, "resident_matrix_bytes": client.resident_bytes,
                      "first_response_metrics": first["metrics"], "auth_unauthorized": 401}))
finally:
    if server:
        server.shutdown()
        server.server_close()
    if thread:
        thread.join(timeout=2)
    client.close()
    assert client.process.poll() is not None
    print(json.dumps({"owned_worker_cleanup": "PASS", "worker_exit": client.process.returncode}))
