"""Protocol-only test fixture,NOT a model/backend for Nori. No network calls."""
import os
from pathlib import Path
import struct
import sys
import threading
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import norllama as n

lock = threading.Lock()
active = {}
threads = []

def send(kind, request_id, data=b""):
    with lock:
        sys.stdout.buffer.write(n.HEADER.pack(n.MAGIC, kind, request_id, len(data)) + data)
        sys.stdout.buffer.flush()

def run(request_id, payload, cancelled, json_object=False, contract=False):
    if contract:
        length = struct.unpack_from('<I', payload)[0]
        if payload[4:8] != b'NGM2' or length > len(payload) - 4:
            send(n.ERROR, request_id, b'invalid fixture grammar framing')
            return
        payload = payload[4+length:]
    limit, count = struct.unpack_from("<II", payload)
    at = 8
    content = ""
    for _ in range(count):
        _, length = struct.unpack_from("<BI", payload, at)
        at += 5
        content = payload[at:at+length].decode("utf-8")
        at += length
    if content == "__crash":
        os._exit(17)
    if content == "__slow" and cancelled.wait(2):
        send(n.CANCELLED, request_id)
        return
    if content == "__error":
        send(n.ERROR, request_id, b"intentional fixture inference failure")
        return
    if json_object or contract:
        fragments = [b'{"fixture":', b'true}']
    elif content == "__invalid_utf8":
        fragments = [b"\xf0\x9f"]
    elif limit == 1:
        fragments = [b"Hello"]
    else:
        raw = "Hi \U0001f30c".encode("utf-8")
        fragments = [raw[:5], raw[5:]]
    for chunk in fragments:
        if cancelled.is_set():
            send(n.CANCELLED, request_id)
            return
        send(n.TOKEN, request_id, chunk)
    stats = b"bad" if content == "__bad_metrics" else struct.pack("<IIdB", len(fragments), 10, 0.001, 1)
    send(n.METRICS, request_id, stats)
    send(n.DONE, request_id)

send(n.READY, 0, struct.pack("<QII", 42, 2048, 2048) + b"TEST-NOT-A-GPU")
try:
    while True:
        kind, request_id, payload = n.read_frame(sys.stdin.buffer)
        if kind == n.SHUTDOWN:
            break
        if kind == n.CANCEL:
            if request_id in active:
                active[request_id].set()
        elif kind in {n.CHAT, n.JSON_CHAT, n.CONTRACT_CHAT}:
            event = threading.Event()
            active[request_id] = event
            thread = threading.Thread(target=run, args=(request_id, payload, event, kind == n.JSON_CHAT, kind == n.CONTRACT_CHAT))
            thread.start()
            threads.append(thread)
finally:
    for event in active.values():
        event.set()
    for thread in threads:
        thread.join(timeout=3)
