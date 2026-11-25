"""Owned real CUDA/service acceptance, not a fake worker or model quality claim."""
import argparse
import ctypes
from ctypes import wintypes
from hashlib import sha256
import http.client
import json
import os
from pathlib import Path
import queue
import secrets
import struct
import subprocess
import sys
import threading
import time
import unittest

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "runtime/norllama"))
import norllama as n
from owned_process import OwnedProcessJob

WORKER = ROOT / "engine/norama/norama-dualtrace-worker.exe"
DIAGNOSTIC = ROOT / "engine/norama/norama-dualtrace.exe"
MODEL = ROOT / "models/nori-development/dualtrace-v0-b8_o6n4g/weights.ndt"
CONFIG = ROOT / "runtime/norllama/dualtrace.experimental.json"
EVIDENCE = {}


def tokens_for(messages):
    text = "".join(f"[{m['role']}]\n{m['content']}\n" for m in messages) + "[assistant]\n"
    return [256, *text.encode("utf-8")]


def expected(messages, limit):
    process = subprocess.run([str(DIAGNOSTIC), str(MODEL), "gpu", f"--generate={limit}",
                              *map(str, tokens_for(messages))], cwd=ROOT, capture_output=True,
                             text=True, timeout=10)
    if process.returncode:
        raise AssertionError(process.stderr)
    result = json.loads(process.stdout)
    if result["reset_max_error"] != 0 or any(t >= 256 for t in result["generated"]):
        raise AssertionError("Diagnostic output/reset invalid")
    return bytes(result["generated"]).decode("utf-8", errors="strict")


def collect(client, messages, limit=32):
    text, metrics = [], None
    with client.request(messages, limit) as request:
        while not request.complete:
            kind, value = request.next()
            if kind == "token":
                text.append(value)
            elif kind == "metrics":
                metrics = value
    return "".join(text), metrics


def call(port, key, path="/health", body=None, *, auth=True, origin=None, raw=False):
    connection = http.client.HTTPConnection("127.0.0.1", port, timeout=5)
    try:
        headers = {"Content-Type": "application/json"}
        if auth:
            headers["Authorization"] = "Bearer " + key
        if origin:
            headers["Origin"] = origin
        connection.request("GET" if body is None else "POST", path,
                           body=None if body is None else json.dumps(body), headers=headers)
        response = connection.getresponse()
        data = response.read()
        return response.status, data if raw else json.loads(data)
    finally:
        connection.close()


class RealServiceTests(unittest.TestCase):
    def setUp(self):
        self.client = n.WorkerClient([str(WORKER), str(MODEL)], ROOT,
                                    architecture=n.OWN_ARCHITECTURE, request_timeout=10)

    def tearDown(self):
        self.client.close()
        self.assertIsNotNone(self.client.process.poll())

    def test_resident_gpu_reuse_and_request_reset(self):
        pid = self.client.process.pid
        health = self.client.health()
        self.assertTrue(health["nori_trained_model"])
        self.assertFalse(health["imported_weights"])
        self.assertFalse(health["assistant_qualified"])
        self.assertTrue(health["experimental"])
        self.assertIn("RTX 4080 SUPER", health["device"])
        self.assertEqual((health["max_prompt_tokens"], health["max_output_tokens"]), (512, 256))
        raw = MODEL.read_bytes()
        _, width, layers, count, _, _ = struct.unpack("<6I", raw[8:32])
        self.assertEqual(health["resident_matrix_bytes"],
                         count * 4 + 2 * layers * width * 4 + 258 * 4 + layers * 72)
        examples = [[{"role": "user", "content": text}] for text in ("Nori", "purple 🟣 café 東京", "Nori")]
        outputs = []
        for messages in examples:
            text, metrics = collect(self.client, messages)
            self.assertEqual(text, expected(messages, 32))
            self.assertEqual(metrics["prompt_tokens"], len(tokens_for(messages)))
            self.assertEqual(metrics["output_tokens"], len(text.encode("utf-8")))
            self.assertEqual(self.client.process.pid, pid)
            outputs.append(text)
        self.assertEqual(outputs[0], outputs[2])
        EVIDENCE["resident_reuse"] = {"same_worker": True, "device": health["device"],
                                    "graph_allocation_bytes": health["resident_matrix_bytes"],
                                    "requests": len(examples), "isolated_repeat_equal": True,
                                    "diagnostic_generation_equal": True}

    def test_limits_and_unqualified_modes_rejected_before_admission(self):
        messages = [{"role": "user", "content": "Nori"}]
        sequence = self.client.sequence
        for limit, items, kwargs in ((257, messages, {}), (1, [{"role":"user", "content":"x"*500}], {}),
                                    (1, messages, {"json_object":True}),
                                    (1, messages, {"contract_schema":{"const":{}}})):
            with self.assertRaises(ValueError):
                with self.client.request(items, limit, **kwargs):
                    self.fail("Unsupported own-model request dispatched")
        self.assertEqual(sequence, self.client.sequence)
        self.assertEqual(collect(self.client, messages, 8)[0], expected(messages, 8))

    def test_cancel_during_real_gpu_prefill_then_reuse(self):
        messages = [{"role": "user", "content": "x" * 200}]
        pid = self.client.process.pid
        for _ in range(4):
            with self.client.request(messages, 256) as request:
                self.assertTrue(self.client.cancel(request.id))
                with self.assertRaises(n.RuntimeCancelled):
                    while not request.complete:
                        request.next()
        self.assertEqual(collect(self.client, [{"role":"user", "content":"Nori"}], 8)[0],
                         expected([{"role":"user", "content":"Nori"}], 8))
        self.assertEqual(self.client.process.pid, pid)
        EVIDENCE["cancellation"] = {"real_requests_cancelled": 4, "same_worker_reusable": True}

    def test_crash_fails_closed_without_restart_or_fallback(self):
        pid = self.client.process.pid
        self.client.process.terminate()
        self.client.process.wait(timeout=5)
        with self.assertRaises(n.ProtocolError):
            collect(self.client, [{"role":"user", "content":"Nori"}])
        self.assertFalse(self.client.health()["ready"])
        self.assertEqual(self.client.process.pid, pid)

    def test_wrong_architecture_handshake_refused(self):
        with self.assertRaises(n.ProtocolError):
            n.WorkerClient([str(WORKER), str(MODEL)], ROOT)  # Imported profile cannot label own graph.
        with self.assertRaises(ValueError):
            n.WorkerClient([str(WORKER), str(MODEL)], ROOT, architecture="ollama")

    def test_real_http_auth_provenance_explicit_route_and_stream(self):
        key = secrets.token_urlsafe(32)
        server = n.RuntimeServer(("127.0.0.1", 0), self.client, key, "nori-dualtrace-v0-development")
        thread = threading.Thread(target=server.serve_forever, kwargs={"poll_interval":0.05})
        thread.start()
        try:
            self.assertEqual(call(server.server_port, key, auth=False)[0], 401)
            self.assertEqual(call(server.server_port, key, origin="https://untrusted.invalid")[0], 403)
            status, models = call(server.server_port, key, "/v1/models")
            self.assertEqual(status, 200)
            entry = models["models"][0]
            self.assertEqual(entry["provenance"], "scratch-trained-experimental")
            self.assertFalse(entry["assistant_qualified"])
            messages = [{"role":"user", "content":"Nori"}]
            body = {"model_id":entry["id"], "messages":messages, "max_tokens":16, "stream":False}
            self.assertEqual(call(server.server_port, key, "/v1/chat", body)[0], 409)
            status, answer = call(server.server_port, key, "/v1/experimental/chat", body)
            self.assertEqual(status, 200)
            self.assertEqual(answer["text"], expected(messages, 16))
            status, data = call(server.server_port, key, "/v1/experimental/chat", {**body,"stream":True}, raw=True)
            self.assertEqual(status, 200)
            self.assertIn(b"event: token", data)
            self.assertIn(b"data: [DONE]", data)
            pieces = [json.loads(line[6:])["text"] for line in data.decode().splitlines()
                      if line.startswith("data: {") and '"text"' in line]
            self.assertEqual("".join(pieces), expected(messages, 16))
            for change in ({"model_id":"missing"}, {"max_tokens":257}, {"tools":[]},
                           {"messages":[{"role":"user","content":"x"*500}]}):
                self.assertEqual(call(server.server_port, key, "/v1/experimental/chat", {**body,**change})[0], 422)
            with self.client.request([{"role":"user","content":"x"*200}], 256) as request:
                status, cancellation = call(server.server_port,key,"/v1/cancel",{"request_id":request.id})
                self.assertEqual(status,200)
                self.assertTrue(cancellation["cancelled"])
                with self.assertRaises(n.RuntimeCancelled):
                    while not request.complete:request.next()
            self.assertEqual(collect(self.client,messages,8)[0],expected(messages,8))
            EVIDENCE["http"] = {"auth_required":True, "browser_origin_denied":True,
                                "normal_chat_denied":True, "experimental_stream_and_nonstream_equal":True,
                                "unsupported_models_tools_budgets_refused":True,
                                "active_http_cancel_and_reuse":True}
        finally:
            server.shutdown();server.server_close();thread.join(timeout=2)

    def test_worker_pipe_eof_exits_cleanly(self):
        process = subprocess.Popen([str(WORKER), str(MODEL)], cwd=ROOT, stdin=subprocess.PIPE,
                                   stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                                   creationflags=getattr(subprocess,"CREATE_NO_WINDOW",0))
        job = OwnedProcessJob(process)
        try:
            kind, request_id, payload = n.read_frame(process.stdout)
            self.assertEqual((kind, request_id), (n.READY, 0))
            self.assertEqual(payload[16:20], b"NDT0")
            process.stdin.close()
            self.assertEqual(process.wait(timeout=5), 0)
            EVIDENCE["worker_eof"] = {"exit_code":0}
        finally:
            job.close()
            if process.poll() is None:
                process.wait(timeout=5)
            process.stdout.close()


class LauncherTests(unittest.TestCase):
    def test_opt_in_is_required_before_service_spawn(self):
        process = subprocess.run([sys.executable,"-B",str(ROOT/"runtime/norllama/norllama.py"),
                                  "--config",str(CONFIG),"--port","0"], cwd=ROOT,
                                 capture_output=True,text=True,timeout=10)
        self.assertNotEqual(process.returncode,0)
        self.assertEqual(process.stdout, "")
        self.assertIn("explicit --experimental-own-model",process.stderr)

    def check_launcher_stop(self, stop_by):
        key = secrets.token_urlsafe(32)
        process = subprocess.Popen([sys.executable,"-B",str(ROOT/"runtime/norllama/norllama.py"),
                                    "--config",str(CONFIG),"--experimental-own-model","--port","0","--supervised"],
                                   cwd=ROOT,env={**os.environ,"NORI_RUNTIME_API_KEY":key},
                                   stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,
                                   creationflags=getattr(subprocess,"CREATE_NO_WINDOW",0))
        job = OwnedProcessJob(process)
        inbox = queue.Queue()
        reader = threading.Thread(target=lambda:inbox.put(process.stdout.readline()),daemon=True)
        reader.start()
        kernel = ctypes.WinDLL("kernel32",use_last_error=True)
        kernel.OpenProcess.argtypes=[wintypes.DWORD,wintypes.BOOL,wintypes.DWORD]
        kernel.OpenProcess.restype=wintypes.HANDLE
        kernel.WaitForSingleObject.argtypes=[wintypes.HANDLE,wintypes.DWORD]
        kernel.WaitForSingleObject.restype=wintypes.DWORD
        kernel.CloseHandle.argtypes=[wintypes.HANDLE];kernel.CloseHandle.restype=wintypes.BOOL
        worker_handle = None
        try:
            ready = json.loads(inbox.get(timeout=15))
            self.assertTrue(ready["experimental"])
            self.assertEqual(ready["architecture"],n.OWN_ARCHITECTURE)
            worker_handle=kernel.OpenProcess(0x100000,False,ready["worker_pid"])
            if not worker_handle:
                raise ctypes.WinError(ctypes.get_last_error())
            status,health=call(ready["port"],key)
            self.assertEqual(status,200)
            self.assertTrue(health["nori_trained_model"])
            configured_model = json.loads(CONFIG.read_text(encoding="utf-8"))["model_id"]
            self.assertEqual(health["model_id"], configured_model)
            body={"model_id":configured_model, "messages":[{"role":"user","content":"Nori"}],
                  "max_tokens":8,"stream":False}
            status,answer=call(ready["port"],key,"/v1/experimental/chat",body)
            self.assertEqual(status,200)
            self.assertEqual(answer["text"],expected(body["messages"],8))
            if stop_by=="owner_eof":
                process.stdin.close()
            elif stop_by=="http_shutdown":
                status,answer=call(ready["port"],key,"/v1/shutdown",{})
                self.assertEqual((status,answer),(200,{"shutdown":True}))
            else:
                self.fail("Unknown owned stop test")
            self.assertEqual(process.wait(timeout=8),0)
            self.assertEqual(kernel.WaitForSingleObject(worker_handle,3000),0)
            EVIDENCE[f"launcher_{stop_by}"]={"runtime_exit_code":0,"gpu_worker_exited":True,
                                           "authenticated_own_model_http_generation_equal":True}
        finally:
            job.close()
            if process.poll() is None:
                process.wait(timeout=5)
            reader.join(timeout=2)
            for pipe in (process.stdin,process.stdout):
                if pipe and not pipe.closed:pipe.close()
            if worker_handle:kernel.CloseHandle(worker_handle)

    def test_actual_launcher_and_owner_eof_stop_runtime_and_gpu_worker(self):
        self.check_launcher_stop("owner_eof")

    def test_authenticated_shutdown_stops_actual_runtime_and_gpu_worker(self):
        self.check_launcher_stop("http_shutdown")


if __name__=="__main__":
    parser=argparse.ArgumentParser()
    parser.add_argument("--receipt",type=Path)
    parser.add_argument("--config",type=Path)
    args=parser.parse_args()
    if args.config:
        candidate=args.config.resolve(strict=True)
        if candidate.parent!=(ROOT/"runtime/norllama").resolve():
            raise ValueError("Explicit test config must be in the owned runtime directory")
        config=json.loads(candidate.read_text(encoding="utf-8"))
        model=(ROOT/config["model_path"]).resolve(strict=True)
        if config.get("architecture")!=n.OWN_ARCHITECTURE or not model.is_relative_to((ROOT/"models/nori-development").resolve()):
            raise ValueError("Explicit probe requires own development model")
        CONFIG,MODEL=candidate,model
    receipt=None
    if args.receipt:
        receipt=args.receipt.resolve()
        if receipt.parent!=(ROOT/"verification").resolve() or receipt.exists():
            raise ValueError("Fresh receipt directly under verification required")
    suite=unittest.TestSuite((unittest.defaultTestLoader.loadTestsFromTestCase(RealServiceTests),
                             unittest.defaultTestLoader.loadTestsFromTestCase(LauncherTests)))
    result=unittest.TextTestRunner(verbosity=2).run(suite)
    if receipt:
        sources=(Path(__file__),ROOT/"runtime/norllama/norllama.py",CONFIG,
                 ROOT/"engine/norama/src/dualtrace_worker.cu",ROOT/"engine/norama/src/dualtrace_gpu.cuh",
                 ROOT/"engine/norama/src/dualtrace_model.hpp",ROOT/"engine/norama/src/worker_protocol.hpp",
                 ROOT/"engine/norama/build-dualtrace.ps1")
        record={"passed":result.wasSuccessful(),"tests_run":result.testsRun,
                "failures":len(result.failures),"errors":len(result.errors),"evidence":EVIDENCE,
                "assistant_qualified":False,"production_default_changed":False,
                "worker_sha256":sha256(WORKER.read_bytes()).hexdigest(),
                "model_sha256":sha256(MODEL.read_bytes()).hexdigest(),
                "diagnostic_sha256":sha256(DIAGNOSTIC.read_bytes()).hexdigest(),
                "sources":{str(p.relative_to(ROOT)):sha256(p.read_bytes()).hexdigest() for p in sources}}
        with receipt.open("x",encoding="utf-8") as handle:
            json.dump(record,handle,indent=2,allow_nan=False);handle.flush();os.fsync(handle.fileno())
    raise SystemExit(0 if result.wasSuccessful() else 1)
