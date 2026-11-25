"""Nori-owned local serving policy around the independently implemented Norama engine.

Only standard Python/Windows platform APIs; no external inference client/backend.
One resident process, serial execution, bounded admission, request-isolated KV state.
"""
from __future__ import annotations

import argparse
import codecs
import contextlib
import ctypes
from ctypes import wintypes
import hmac
import json
import math
import os
from pathlib import Path
import queue
import re
import struct
import subprocess
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from owned_process import OwnedProcessJob
from installation_paths import runtime_installation

# Core's owned contracts are shipped beside this runtime, not resolved from
# a developer environment or external agent framework.
INSTALLATION_ROOT, DEFAULT_CONFIG = runtime_installation(__file__)
sys.path.append(str(INSTALLATION_ROOT / 'nori'))

MAGIC = b"NRW1"
HEADER = struct.Struct("<4sBII")
MAX_FRAME = 262144
CHAT, CANCEL, SHUTDOWN = 1, 2, 3
JSON_CHAT = 4  # Explicit syntax-only experiment; not exposed as a tool/API grant.
CONTRACT_CHAT = 5  # Explicit local subset grammar experiment; no tool authority.
READY, TOKEN, METRICS, DONE, ERROR, CANCELLED = 16, 17, 18, 19, 20, 21
TERMINAL = {DONE, ERROR, CANCELLED}
IMPORTED_ARCHITECTURE = "imported-llama"
OWN_ARCHITECTURE = "nori-dualtrace-v0"


class RuntimeBusy(RuntimeError):
    pass


class ProtocolError(RuntimeError):
    pass


class RuntimeCancelled(RuntimeError):
    pass


class OwnerPipeWatcher:
    """Cancellable Windows pipe polling, never a blocked Python buffered read.

    A daemon inside sys.stdin.buffer.read can outlive HTTP shutdown and crash
    Windows Python during interpreter finalization. Stop/join before teardown.
    """
    def __init__(self, pipe, shutdown):
        import msvcrt
        self.kernel = ctypes.WinDLL("kernel32", use_last_error=True)
        self.kernel.GetFileType.argtypes = [wintypes.HANDLE]
        self.kernel.GetFileType.restype = wintypes.DWORD
        self.kernel.PeekNamedPipe.argtypes = [wintypes.HANDLE, ctypes.c_void_p, wintypes.DWORD,
                                             ctypes.c_void_p, ctypes.POINTER(wintypes.DWORD), ctypes.c_void_p]
        self.kernel.PeekNamedPipe.restype = wintypes.BOOL
        self.kernel.ReadFile.argtypes = [wintypes.HANDLE, ctypes.c_void_p, wintypes.DWORD,
                                        ctypes.POINTER(wintypes.DWORD), ctypes.c_void_p]
        self.kernel.ReadFile.restype = wintypes.BOOL
        self.handle = wintypes.HANDLE(msvcrt.get_osfhandle(pipe.fileno()))
        if self.kernel.GetFileType(self.handle) != 3:
            raise ValueError("Supervised runtime requires its owning launcher's stdin pipe")
        self.stopping = threading.Event()
        self.shutdown = shutdown
        self.thread = threading.Thread(target=self._watch, name="norllama-owner-lifetime", daemon=True)

    def _watch(self):
        buffer = ctypes.create_string_buffer(256)
        while not self.stopping.is_set():
            available = wintypes.DWORD()
            if not self.kernel.PeekNamedPipe(self.handle, None, 0, None, ctypes.byref(available), None):
                if not self.stopping.is_set():
                    self.shutdown()  # EOF or a broken lifetime signal both fail closed.
                return
            if available.value:
                received = wintypes.DWORD()
                if not self.kernel.ReadFile(self.handle, buffer, min(256, available.value), ctypes.byref(received), None):
                    if not self.stopping.is_set():
                        self.shutdown()
                    return
            else:
                self.stopping.wait(0.05)

    def start(self):
        self.thread.start()

    def close(self):
        self.stopping.set()
        if self.thread.ident is not None:
            self.thread.join(timeout=2)
            if self.thread.is_alive():
                raise RuntimeError("Owning pipe watcher did not quiesce")


class WorkerLifetimeWatcher:
    """Drain the serving process when its sole owned inference worker fails.

    A 503 health endpoint alone is insufficient: the owning desktop watches
    runtime lifetime and must be able to close Core after worker loss.
    """
    def __init__(self, client, shutdown):
        self.client = client
        self.shutdown = shutdown
        self.stopping = threading.Event()
        self.failure_detected = False
        self.thread = threading.Thread(target=self._watch, name="norllama-worker-lifetime", daemon=True)

    def _watch(self):
        while not self.stopping.is_set():
            try:
                ready = self.client.health()["ready"] is True
            except Exception:
                ready = False
            if not ready:
                if not self.stopping.is_set():
                    self.failure_detected = True
                    self.shutdown()
                return
            self.stopping.wait(0.05)

    def start(self):
        self.thread.start()

    def close(self):
        self.stopping.set()
        if self.thread.ident is not None:
            self.thread.join(timeout=2)
            if self.thread.is_alive():
                raise RuntimeError("Owned worker watcher did not quiesce")


def read_exact(pipe, length):
    parts = bytearray()
    while len(parts) < length:
        data = pipe.read(length - len(parts))
        if not data:
            raise ProtocolError("native worker pipe ended")
        parts.extend(data)
    return bytes(parts)


def read_frame(pipe):
    magic, kind, request_id, length = HEADER.unpack(read_exact(pipe, HEADER.size))
    if magic != MAGIC or length > MAX_FRAME:
        raise ProtocolError("invalid native worker frame")
    return kind, request_id, read_exact(pipe, length)


def chat_payload(messages, max_tokens):
    if type(max_tokens) is not int or not 1 <= max_tokens <= 2048:
        raise ValueError("max_tokens must be an integer from1 to2048")
    if not isinstance(messages, list) or not 1 <= len(messages) <= 64:
        raise ValueError("messages must contain1..64 text messages")
    result = bytearray(struct.pack("<II", max_tokens, len(messages)))
    total = 0
    for message in messages:
        if not isinstance(message, dict) or set(message) != {"role", "content"}:
            raise ValueError("only role/content text messages are supported")
        if message["role"] not in {"system", "user", "assistant"} or not isinstance(message["content"], str):
            raise ValueError("unsupported role or non-text content")
        raw = message["content"].encode("utf-8", errors="strict")
        total += len(raw)
        if len(raw) > 65536 or total > 245760:
            raise ValueError("chat text exceeds byte budget")
        role = {"system": 1, "user": 2, "assistant": 3}[message["role"]]
        result.extend(struct.pack("<BI", role, len(raw)))
        result.extend(raw)
    if len(result) > MAX_FRAME:
        raise ValueError("chat frame exceeds byte budget")
    return bytes(result)


def dualtrace_payload(messages, max_tokens):
    if type(max_tokens) is not int or not 1 <= max_tokens <= 256:
        raise ValueError("DualTrace max_tokens must be1..256")
    payload = chat_payload(messages, max_tokens)
    # Must match the owned worker's explicit development framing exactly.
    prompt_bytes = 1 + len(b"[assistant]\n")
    for message in messages:
        prompt_bytes += len(message["role"].encode("ascii")) + 4 + len(message["content"].encode("utf-8"))
    if prompt_bytes + max_tokens > 512:
        raise ValueError("DualTrace framed prompt plus generation exceeds512 tokens")
    return payload


class Request:
    def __init__(self, client, request_id, inbox, deadline, max_tokens):
        self.client, self.id, self.inbox, self.deadline = client, request_id, inbox, deadline
        self.complete = False
        self.decoder = codecs.getincrementaldecoder("utf-8")(errors="strict")
        self.output_bytes = 0
        self.token_frames = 0
        self.seen_metrics = False
        self.max_tokens = max_tokens

    def next(self):
        try:
            return self._next()
        except (ProtocolError, UnicodeError):
            if not self.client.closing:
                self.client.poison("native output contract failed")
            raise

    def _next(self):
        if self.complete:
            raise ProtocolError("request already completed")
        if self.client.closing:
            raise ProtocolError("native runtime is closing")
        remaining = self.deadline - time.monotonic()
        if remaining <= 0:
            raise TimeoutError("native inference deadline exceeded")
        try:
            item = self.inbox.get(timeout=min(remaining, 0.25))
        except queue.Empty:
            return "heartbeat", None
        if isinstance(item, Exception):
            raise item
        kind, payload = item
        if kind == TOKEN:
            if self.seen_metrics:
                raise ProtocolError("native token after final metrics")
            self.token_frames += 1
            if self.token_frames > self.max_tokens:
                raise ProtocolError("native token count exceeds limit")
            self.output_bytes += len(payload)
            if self.output_bytes > MAX_FRAME:
                raise ProtocolError("native output exceeds byte budget")
            return "token", self.decoder.decode(payload)
        if kind == METRICS:
            if len(payload) != 17 or self.seen_metrics:
                raise ProtocolError("invalid native metrics")
            generated, prompt, seconds, reason = struct.unpack("<IIdB", payload)
            if not math.isfinite(seconds) or seconds < 0 or generated != self.token_frames or not 1 <= prompt <= self.client.prompt_limit or reason not in {1, 2}:
                raise ProtocolError("invalid native metrics values")
            self.seen_metrics = True
            return "metrics", {"request_id": self.id, "output_tokens": generated, "prompt_tokens": prompt,
                               "inference_seconds": seconds, "finish_reason": "stop" if reason == 1 else "length"}
        if kind in TERMINAL:
            self.complete = True
            if kind == ERROR:
                raise RuntimeError(payload.decode("utf-8", errors="strict"))
            if payload:
                raise ProtocolError("unexpected terminal payload")
            if kind == CANCELLED:
                raise RuntimeCancelled("native request cancelled")
            if not self.seen_metrics:
                raise ProtocolError("native stream completed without final metrics")
            self.decoder.decode(b"", final=True)  # Never replace an incomplete Unicode suffix.
            return "done", None
        raise ProtocolError("unexpected native event")

    def close(self):
        if not self.complete and not self.client.failed and not self.client.closing:
            self.client.cancel(self.id)
            deadline = time.monotonic() + 3
            while time.monotonic() < deadline:
                try:
                    item = self.inbox.get(timeout=max(0.001, min(0.25, deadline - time.monotonic())))
                except queue.Empty:
                    continue
                if isinstance(item, Exception):
                    break
                if item[0] in TERMINAL:
                    self.complete = True
                    break
            if not self.complete:
                self.client.poison("native cancellation did not quiesce")


class WorkerClient:
    def __init__(self, command, cwd, *, startup_timeout=30, request_timeout=120, queue_timeout=5,
                 architecture=IMPORTED_ARCHITECTURE):
        if not 0 < request_timeout <= 300 or not 0 < queue_timeout <= 30:
            raise ValueError("invalid runtime time budgets")
        if architecture not in {IMPORTED_ARCHITECTURE, OWN_ARCHITECTURE}:
            raise ValueError("unsupported architecture; no fallback")
        self.architecture = architecture
        self.experimental = architecture == OWN_ARCHITECTURE
        self.request_timeout, self.queue_timeout = request_timeout, queue_timeout
        self.state = threading.Lock()
        self.write_lock = threading.Lock()
        self.execution = threading.Lock()
        self.admission = threading.BoundedSemaphore(3)  # One executing,two waiting at most.
        self.active = None
        self.sequence = 0
        self.terminal_id = 0
        self.failed = False
        self.closing = False
        self.ready = queue.Queue(maxsize=1)
        self.process = subprocess.Popen(list(command), cwd=str(cwd), stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                        stderr=subprocess.DEVNULL, bufsize=0, shell=False,
                                        creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
        try:
            self.process_job = OwnedProcessJob(self.process)
        except Exception:
            self.process.terminate()
            self.process.wait(timeout=5)
            self.process.stdin.close()
            self.process.stdout.close()
            raise
        self.reader = threading.Thread(target=self._read, name="norllama-worker-frames", daemon=True)
        self.reader.start()
        try:
            item = self.ready.get(timeout=startup_timeout)
            if isinstance(item, Exception):
                raise item
            if len(item) < 16:
                raise ProtocolError("invalid native ready payload")
            self.resident_bytes, self.prompt_limit, self.output_limit = struct.unpack("<QII", item[:16])
            name = item[16:]
            if self.experimental:
                if not name.startswith(b"NDT0"):
                    raise ProtocolError("DualTrace architecture handshake missing")
                name = name[4:]
            self.device = name.decode("utf-8", errors="strict")
            limits = (512, 256) if self.experimental else (2048, 2048)
            if not self.resident_bytes or (self.prompt_limit, self.output_limit) != limits or not 1 <= len(self.device) <= 128:
                raise ProtocolError("unsupported native worker capability contract")
        except Exception:
            self.close()
            raise

    def poison(self, reason):
        with self.state:
            self.failed = True
            active = self.active
        failure = ProtocolError(reason)
        try:
            self.ready.put_nowait(failure)
        except queue.Full:
            pass
        if active:
            try:
                active[1].put_nowait(failure)
            except queue.Full:
                pass
        if self.process.poll() is None:
            self.process.terminate()  # Only this owned child; no other Nori processes.

    def _read(self):
        received_ready = False
        try:
            while True:
                kind, request_id, payload = read_frame(self.process.stdout)
                if not received_ready and kind == READY and request_id == 0:
                    self.ready.put_nowait(payload)
                    received_ready = True
                    continue
                with self.state:
                    active = self.active
                    if active and request_id == active[0] and self.terminal_id == request_id:
                        raise ProtocolError("duplicate event after native terminal")
                    if kind in TERMINAL:
                        self.terminal_id = request_id
                if not received_ready or not active or active[0] != request_id or kind not in {TOKEN, METRICS, *TERMINAL}:
                    raise ProtocolError("native stream ownership/contract violation")
                try:
                    active[1].put_nowait((kind, payload))
                except queue.Full:
                    raise ProtocolError("native consumer exceeded bounded event backlog")
        except Exception:
            if not self.closing:
                self.poison("native worker unavailable or invalid stream")

    def _send(self, kind, request_id, payload=b""):
        if len(payload) > MAX_FRAME:
            raise ValueError("native frame exceeds byte budget")
        with self.write_lock:
            if self.failed or self.closing or self.process.poll() is not None:
                raise ProtocolError("native worker is unavailable")
            packet = HEADER.pack(MAGIC, kind, request_id, len(payload)) + payload
            at = 0
            while at < len(packet):
                count = self.process.stdin.write(packet[at:])
                if not count:
                    raise ProtocolError("native worker pipe write failed")
                at += count
            self.process.stdin.flush()

    def cancel(self, request_id):
        with self.state:
            valid = bool(self.active and self.active[0] == request_id)
        if valid:
            self._send(CANCEL, request_id)
        return valid

    @contextlib.contextmanager
    def request(self, messages, max_tokens, *, json_object=False, contract_schema=None):
        if type(json_object) is not bool:
            raise ValueError("json_object must be an explicit boolean")
        if self.experimental and (json_object or contract_schema is not None):
            raise ValueError("DualTrace has no qualified JSON/contract mode")
        payload = dualtrace_payload(messages, max_tokens) if self.experimental else chat_payload(messages, max_tokens)
        kind = JSON_CHAT if json_object else CHAT
        if contract_schema is not None:
            if json_object: raise ValueError('Choose either syntax or contract mode, not both')
            from contract_grammar import compile_grammar
            program = compile_grammar(contract_schema)
            payload = struct.pack('<I', len(program)) + program + payload
            kind = CONTRACT_CHAT
        if len(payload) > MAX_FRAME: raise ValueError('Native contract/chat frame exceeds byte budget')
        if not self.admission.acquire(blocking=False):
            raise RuntimeBusy("native request queue is full")
        acquired = False
        handle = None
        try:
            acquired = self.execution.acquire(timeout=self.queue_timeout)
            if not acquired:
                raise RuntimeBusy("native request queue deadline exceeded")
            if self.sequence >= 0xFFFFFFFF:
                raise ProtocolError("native sequence exhausted; restart required")
            self.sequence += 1
            inbox = queue.Queue(maxsize=64)
            handle = Request(self, self.sequence, inbox, time.monotonic() + self.request_timeout, max_tokens)
            with self.state:
                self.active = (handle.id, inbox)
            self._send(kind, handle.id, payload)
            yield handle
        finally:
            try:
                if handle:
                    handle.close()
            finally:
                if acquired:
                    with self.state:
                        self.active = None
                    self.execution.release()
                self.admission.release()

    def health(self):
        with self.state:
            active_id = self.active[0] if self.active else None
        return {"ready": not self.failed and not self.closing and self.process.poll() is None,
                "backend": "norama-independent", "worker_pid": self.process.pid,
                "resident_matrix_bytes": self.resident_bytes, "device": self.device,
                "active_request_id": active_id, "max_prompt_tokens": self.prompt_limit,
                "max_output_tokens": self.output_limit, "max_admitted_requests": 3,
                "architecture": self.architecture, "experimental": self.experimental,
                "assistant_qualified": False,
                "imported_weights": not self.experimental, "nori_trained_model": self.experimental}

    def close(self):
        self.closing = True
        if self.process.poll() is None:
            try:
                with self.write_lock:
                    self.process.stdin.write(HEADER.pack(MAGIC, SHUTDOWN, 0, 0))
                    self.process.stdin.flush()
                    self.process.stdin.close()
                self.process.wait(timeout=5)
            except Exception:
                self.process.terminate()
                try:
                    self.process.wait(timeout=2)
                except subprocess.TimeoutExpired:
                    self.process.kill()
                    self.process.wait(timeout=2)
        self.reader.join(timeout=1)
        for pipe in (self.process.stdin, self.process.stdout):
            if pipe and not pipe.closed:
                pipe.close()
        self.process_job.close()


class RuntimeServer(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = False

    def __init__(self, address, client, key, model_id):
        if address[0] != "127.0.0.1" or not re.fullmatch(r"[A-Za-z0-9_-]{32,128}", key):
            raise ValueError("loopback address and32..128 character private key required")
        self.client, self.key, self.model_id = client, key, model_id
        self.connections = threading.BoundedSemaphore(8)
        super().__init__(address, RuntimeHandler)

    def process_request(self, request, client_address):
        if not self.connections.acquire(blocking=False):
            try:
                request.sendall(b"HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\nContent-Length: 0\r\n\r\n")
            finally:
                self.shutdown_request(request)
            return
        try:
            super().process_request(request, client_address)
        except Exception:
            self.connections.release()
            raise

    def process_request_thread(self, request, client_address):
        try:
            super().process_request_thread(request, client_address)
        finally:
            self.connections.release()


class RuntimeHandler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    server_version = "NorLlama/0.1"

    def setup(self):
        super().setup()
        self.connection.settimeout(3)

    def log_message(self, *_):
        pass  # No request bodies,secrets or conversation text in access logs.

    def json_reply(self, status, value):
        body = json.dumps(value, ensure_ascii=False, allow_nan=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("Connection", "close")
        self.end_headers()
        self.wfile.write(body)
        self.close_connection = True

    def authorized(self):
        expected_host = {f"127.0.0.1:{self.server.server_port}", f"localhost:{self.server.server_port}"}
        if len(self.headers.get_all("Host", [])) != 1 or self.headers.get("Host") not in expected_host or self.headers.get("Origin") is not None:
            self.json_reply(403, {"error": "origin_or_host_denied"})
            return False
        supplied = self.headers.get("Authorization", "")
        if len(self.headers.get_all("Authorization", [])) != 1 or len(supplied) > 256 or not supplied.isascii() or not hmac.compare_digest(supplied, f"Bearer {self.server.key}"):
            self.json_reply(401, {"error": "authentication_required"})
            return False
        return True

    def body(self):
        lengths = self.headers.get_all("Content-Length", [])
        if self.headers.get("Transfer-Encoding") or len(lengths) != 1 or not lengths[0].isdigit():
            raise ValueError("one bounded Content-Length is required")
        length = int(lengths[0])
        if not 0 < length <= MAX_FRAME or self.headers.get("Content-Type", "").split(";")[0].strip() != "application/json":
            raise ValueError("bounded application/json body required")
        raw = self.rfile.read(length)
        if len(raw) != length:
            raise ValueError("truncated request body")
        def unique(pairs):
            result = {}
            for name, value in pairs:
                if name in result:
                    raise ValueError("duplicate JSON key")
                result[name] = value
            return result
        value = json.loads(raw.decode("utf-8", errors="strict"), object_pairs_hook=unique,
                           parse_constant=lambda _: (_ for _ in ()).throw(ValueError("nonfinite JSON value")))
        if not isinstance(value, dict):
            raise ValueError("object body required")
        return value

    def do_GET(self):
        if not self.authorized():
            return
        if self.path == "/health":
            health = self.server.client.health()
            self.json_reply(200 if health["ready"] else 503, {**health, "model_id": self.server.model_id})
        elif self.path == "/v1/models":
            health = self.server.client.health()
            self.json_reply(200, {"models": [{"id": self.server.model_id,
                "provenance": "scratch-trained-experimental" if health["experimental"] else "imported",
                "architecture": health["architecture"], "assistant_qualified": False,
                "experimental": health["experimental"], "backend": "norama-independent"}]})
        else:
            self.json_reply(404, {"error": "not_found"})

    def event(self, kind, value):
        if kind == "heartbeat":
            self.wfile.write(b": keepalive\n\n")
        else:
            data = "[DONE]" if kind == "done" else json.dumps(value, ensure_ascii=False, allow_nan=False)
            self.wfile.write(f"event: {kind}\ndata: {data}\n\n".encode("utf-8", errors="strict"))
        self.wfile.flush()

    def do_POST(self):
        if not self.authorized():
            return
        streaming_started = False
        try:
            body = self.body()
            if self.path == "/v1/bound-plan":
                from task_plan import compile_bound_proposal
                if (set(body) - {'allowed_actions', 'required_calls', 'required_dependencies'}
                        or not {'allowed_actions', 'required_calls'} <= set(body)):
                    raise ValueError('Explicit bound-plan contract fields required')
                self.json_reply(200, compile_bound_proposal(body['allowed_actions'], body['required_calls'],
                    required_dependencies=body.get('required_dependencies', [])))
                return
            if self.path == "/v1/shutdown":
                if body:
                    raise ValueError("empty shutdown object required")
                self.json_reply(200, {"shutdown": True})
                threading.Thread(target=self.server.shutdown, name="norllama-shutdown", daemon=True).start()
                return
            if self.path == "/v1/cancel":
                if set(body) != {"request_id"} or type(body["request_id"]) is not int or not 0 < body["request_id"] <= 0xFFFFFFFF:
                    raise ValueError("valid request_id required")
                self.json_reply(200, {"cancelled": self.server.client.cancel(body["request_id"])})
                return
            if self.path == "/v1/chat" and self.server.client.experimental:
                self.json_reply(409, {"error": "experimental_model_requires_explicit_route"})
                return
            experimental_route = self.path == "/v1/experimental/chat" and self.server.client.experimental
            if self.path != "/v1/chat" and not experimental_route:
                self.json_reply(404, {"error": "not_found"})
                return
            if set(body) - {"model_id", "messages", "max_tokens", "stream"} or body.get("model_id") != self.server.model_id:
                raise ValueError("known model_id and supported fields required;no fallback")
            messages, max_tokens, stream = body.get("messages"), body.get("max_tokens", 240), body.get("stream", True)
            if type(stream) is not bool:
                raise ValueError("stream must be boolean")
            chat_payload(messages, max_tokens)
            with self.server.client.request(messages, max_tokens) as request:
                if stream:
                    self.send_response(200)
                    self.send_header("Content-Type", "text/event-stream; charset=utf-8")
                    self.send_header("Cache-Control", "no-store")
                    self.send_header("Connection", "close")
                    self.send_header("X-Nori-Request-ID", str(request.id))
                    self.end_headers()
                    self.close_connection = True
                    streaming_started = True
                    self.event("metrics", {"request_id": request.id, "state": "started"})
                text, stats = [], {}
                while not request.complete:
                    kind, value = request.next()
                    if kind == "token":
                        if value:
                            if stream:
                                self.event("token", {"text": value})
                            else:
                                text.append(value)
                    elif kind == "metrics":
                        stats = value
                        if stream:
                            self.event(kind, value)
                    elif stream:
                        self.event(kind, value)
                if not stream:
                    self.json_reply(200, {"text": "".join(text), "metrics": stats, "model_id": self.server.model_id})
        except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
            pass  # Context cleanup cancels/drains this request before releasing execution.
        except Exception as error:
            if streaming_started:
                try:
                    self.event("error", {"code": "native_request_failed", "message": str(error)[:1024]})
                except OSError:
                    pass
            else:
                status = 503 if isinstance(error, (RuntimeBusy, ProtocolError)) else 504 if isinstance(error, TimeoutError) else 422
                self.json_reply(status, {"error": "native_request_failed", "message": str(error)[:1024]})


def main():
    parser = argparse.ArgumentParser(description="Nori-owned authenticated loopback runtime")
    parser.add_argument("--config", type=Path, default=DEFAULT_CONFIG)
    parser.add_argument("--port", type=int, default=None, help="owned launcher may use0 for an ephemeral loopback port")
    parser.add_argument("--supervised", action="store_true", help="stop on owning launcher's stdin pipe EOF")
    parser.add_argument("--experimental-own-model", action="store_true", help="explicitly authorize the unqualified own-model development route")
    args = parser.parse_args()
    config = json.loads(args.config.read_text(encoding="utf-8-sig"))
    architecture = config.get("architecture", IMPORTED_ARCHITECTURE)
    if architecture not in {IMPORTED_ARCHITECTURE, OWN_ARCHITECTURE}:
        raise ValueError("unsupported model architecture; no fallback")
    if (architecture == OWN_ARCHITECTURE) != args.experimental_own_model:
        raise ValueError("own model requires explicit --experimental-own-model and matching config")
    root = INSTALLATION_ROOT
    paths = []
    for name in ("engine_binary", "model_path"):
        path = (root / config[name]).resolve(strict=True)
        if not path.is_relative_to(root):
            raise ValueError("active runtime components must remain under Nori root")
        paths.append(path)
    binary, model = paths
    key = os.environ.get("NORI_RUNTIME_API_KEY", "")
    if not re.fullmatch(r"[A-Za-z0-9_-]{32,128}", key):
        raise ValueError("NORI_RUNTIME_API_KEY must be a private32..128 character key")
    port = config["port"] if args.port is None else args.port
    if type(port) is not int or not (0 if args.port is not None else 1) <= port <= 65535 or not re.fullmatch(r"[A-Za-z0-9._:-]{1,128}", config["model_id"]):
        raise ValueError("invalid configured runtime port/model identifier")
    client = WorkerClient([str(binary), str(model)], root, architecture=architecture)
    watcher = None
    worker_watcher = None
    server = None
    try:
        server = RuntimeServer(("127.0.0.1", port), client, key, config["model_id"])
        if args.supervised:
            watcher = OwnerPipeWatcher(sys.stdin, server.shutdown)
            watcher.start()
        print(json.dumps({"runtime": "NorLlama", "port": server.server_port, "backend": "norama-independent",
                          "architecture": architecture, "experimental": client.experimental,
                          "worker_pid": client.process.pid}), flush=True)
        worker_watcher = WorkerLifetimeWatcher(client, server.shutdown)
        worker_watcher.start()
        try:
            server.serve_forever(poll_interval=0.25)
        except KeyboardInterrupt:
            pass
        finally:
            server.server_close()
    finally:
        try:
            try:
                if worker_watcher:
                    worker_watcher.close()
            finally:
                if watcher:
                    watcher.close()
        finally:
            if server:
                server.server_close()
            client.close()
    if worker_watcher and worker_watcher.failure_detected:
        raise RuntimeError("Owned inference worker failed; runtime stopped without fallback")


if __name__ == "__main__":
    main()
