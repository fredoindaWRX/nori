import codecs
import http.client
import io
import json
import os
from pathlib import Path
import secrets
import struct
import sys
import threading
import time
import tempfile
import unittest
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import norllama as n

HERE = Path(__file__).resolve().parent
MESSAGES = [{"role": "user", "content": "hello"}]

def collect(client, content="hello", limit=4):
    text = []
    with client.request([{"role": "user", "content": content}], limit) as request:
        while not request.complete:
            kind, value = request.next()
            if kind == "token":
                text.append(value)
    return "".join(text)


class ProtocolTests(unittest.TestCase):
    def test_dualtrace_framed_byte_and_combined_session_bounds(self):
        message = [{"role":"user","content":"x"*235}]
        self.assertEqual(n.dualtrace_payload(message,256), n.chat_payload(message,256))
        for items, limit in (([{"role":"user","content":"x"*236}],256),
                             ([{"role":"user","content":"🟣"*124}],1),
                             (message,257), (message,True)):
            with self.assertRaises(ValueError):
                n.dualtrace_payload(items,limit)
        items=[{"role":"system","content":"local"},{"role":"user","content":"café"}]
        self.assertEqual(n.dualtrace_payload(items,8),n.chat_payload(items,8))

    def test_frame_bounds_magic_truncation(self):
        packet = n.HEADER.pack(n.MAGIC, n.TOKEN, 5, 3) + b"a\0b"
        self.assertEqual(n.read_frame(io.BytesIO(packet)), (n.TOKEN, 5, b"a\0b"))
        for size in range(len(packet)):
            with self.assertRaises(n.ProtocolError):
                n.read_frame(io.BytesIO(packet[:size]))
        for magic, length in [(b"BAD!", 0), (n.MAGIC, n.MAX_FRAME + 1)]:
            with self.assertRaises(n.ProtocolError):
                n.read_frame(io.BytesIO(n.HEADER.pack(magic, n.TOKEN, 1, length)))

    def test_chat_encoding_and_roles(self):
        payload = n.chat_payload([{"role": "user", "content": "\u4f60\u597d\r\n\U0001f30c"}], 4)
        self.assertEqual(struct.unpack_from("<II", payload), (4, 1))
        self.assertEqual(payload[13:], "\u4f60\u597d\r\n\U0001f30c".encode("utf-8"))

    def test_invalid_limits_messages_unicode(self):
        for limit in [0, 2049, True, "4", -1]:
            with self.assertRaises(ValueError):
                n.chat_payload(MESSAGES, limit)
        for messages in [[], [{"role": "tool", "content": "x"}], [{"role": "user", "content": []}],
                         [{"role": "user", "content": "x", "images": []}],
                         [{"role": "user", "content": "x" * 65537}]]:
            with self.assertRaises(ValueError):
                n.chat_payload(messages, 4)
        with self.assertRaises(UnicodeError):
            n.chat_payload([{"role": "user", "content": "\ud800"}], 4)


class ClientTests(unittest.TestCase):
    def setUp(self):
        self.client = n.WorkerClient([sys.executable, "-B", str(HERE / "fake_worker.py")], HERE)

    def tearDown(self):
        self.client.close()
        self.assertIsNotNone(self.client.process.poll())

    def test_persistent_process_unicode_and_isolated_requests(self):
        pid = self.client.process.pid
        self.assertEqual(collect(self.client), "Hi \U0001f30c")
        self.assertEqual(collect(self.client, limit=1), "Hello")
        self.assertEqual(pid, self.client.process.pid)
        self.assertTrue(self.client.health()["ready"])
        self.assertIsNone(self.client.health()["active_request_id"])

    def test_syntax_mode_is_explicit_and_has_no_effect_on_regular_requests(self):
        with self.assertRaises(ValueError):
            with self.client.request(MESSAGES, 4, json_object='yes'):
                self.fail('Non-boolean syntax mode dispatched')
        self.assertEqual(collect(self.client), "Hi \U0001f30c")
        self.assertIsNone(self.client.health()['active_request_id'])
        fragments = []
        with self.client.request(MESSAGES, 4, json_object=True) as request:
            while not request.complete:
                kind, value = request.next()
                if kind == 'token': fragments.append(value)
        self.assertEqual(json.loads(''.join(fragments)), {'fixture': True})
        self.assertEqual(collect(self.client), "Hi \U0001f30c")

    def test_explicit_cancel_and_reuse(self):
        with self.client.request([{"role": "user", "content": "__slow"}], 4) as request:
            self.assertFalse(self.client.cancel(request.id + 1))
            self.assertTrue(self.client.cancel(request.id))
            with self.assertRaises(n.RuntimeCancelled):
                while not request.complete:
                    request.next()
        self.assertEqual(collect(self.client), "Hi \U0001f30c")

    def test_explicit_contract_frame_and_reuse_fixture_not_model_qualification(self):
        schema = {'type': 'object', 'properties': {'fixture': {'const': True}},
                  'required': ['fixture'], 'additionalProperties': False}
        fragments = []
        with self.client.request(MESSAGES, 4, contract_schema=schema) as request:
            while not request.complete:
                kind, value = request.next()
                if kind == 'token': fragments.append(value)
        self.assertEqual(''.join(fragments), '{"fixture":true}')
        self.assertEqual(collect(self.client), "Hi \U0001f30c")

    def test_invalid_or_conflicting_contract_mode_does_not_dispatch(self):
        sequence = self.client.sequence
        for kwargs in ({'contract_schema': {'type': 'number'}},
                       {'json_object': True, 'contract_schema': {'const': {}}}):
            with self.subTest(kwargs=kwargs), self.assertRaises(ValueError):
                with self.client.request(MESSAGES, 4, **kwargs): self.fail('Invalid contract dispatched')
        self.assertEqual(self.client.sequence, sequence)
        self.assertEqual(collect(self.client), "Hi \U0001f30c")

    def test_early_consumer_close_cancels_and_quiesces(self):
        start = time.monotonic()
        with self.client.request([{"role": "user", "content": "__slow"}], 4):
            pass
        self.assertLess(time.monotonic() - start, 1)
        self.assertEqual(collect(self.client), "Hi \U0001f30c")

    def test_engine_error_is_not_success_and_next_request_works(self):
        with self.assertRaisesRegex(RuntimeError, "fixture inference failure"):
            collect(self.client, "__error")
        self.assertEqual(collect(self.client), "Hi \U0001f30c")

    def test_invalid_utf8_fails_closed(self):
        with self.assertRaises(UnicodeError):
            collect(self.client, "__invalid_utf8")
        self.assertFalse(self.client.health()["ready"])

    def test_invalid_metrics_fails_closed(self):
        with self.assertRaises(n.ProtocolError):
            collect(self.client, "__bad_metrics")
        self.assertFalse(self.client.health()["ready"])

    def test_worker_crash_is_not_fallback(self):
        with self.assertRaises(n.ProtocolError):
            collect(self.client, "__crash")
        self.assertFalse(self.client.health()["ready"])

    def test_request_deadline_cancels_before_reuse(self):
        self.client.request_timeout = 0.1
        with self.assertRaises(TimeoutError):
            collect(self.client, "__slow")
        self.client.request_timeout = 1
        self.assertEqual(collect(self.client), "Hi \U0001f30c")

    def test_bounded_admission_and_queue_wait(self):
        self.client.queue_timeout = 0.3
        outcomes = []
        def waiting():
            try:
                collect(self.client)
            except n.RuntimeBusy:
                outcomes.append("busy")
        with self.client.request([{"role": "user", "content": "__slow"}], 4):
            threads = [threading.Thread(target=waiting) for _ in range(2)]
            for thread in threads:
                thread.start()
            deadline = time.monotonic() + 0.2
            while self.client.admission._value and time.monotonic() < deadline:
                time.sleep(0.005)
            self.assertEqual(self.client.admission._value, 0)
            with self.assertRaises(n.RuntimeBusy):
                collect(self.client)
            for thread in threads:
                thread.join(timeout=1)
        self.assertEqual(outcomes, ["busy", "busy"])
        self.assertEqual(collect(self.client), "Hi \U0001f30c")


class HttpTests(unittest.TestCase):
    def setUp(self):
        self.client = n.WorkerClient([sys.executable, "-B", str(HERE / "fake_worker.py")], HERE)
        self.key = secrets.token_urlsafe(32)
        self.server = n.RuntimeServer(("127.0.0.1", 0), self.client, self.key, "test-model")
        self.thread = threading.Thread(target=self.server.serve_forever, kwargs={"poll_interval": 0.05})
        self.thread.start()

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=2)
        self.client.close()

    def call(self, method="GET", path="/health", body=None, *, auth=True, origin=None):
        connection = http.client.HTTPConnection("127.0.0.1", self.server.server_port, timeout=3)
        headers = {"Content-Type": "application/json"}
        if auth:
            headers["Authorization"] = "Bearer " + self.key
        if origin:
            headers["Origin"] = origin
        if isinstance(body, dict):
            body = json.dumps(body)
        connection.request(method, path, body=body, headers=headers)
        response = connection.getresponse()
        result = response.status, response.read()
        connection.close()
        return result

    def test_auth_and_origin_policy(self):
        self.assertEqual(self.call(auth=False)[0], 401)
        self.assertEqual(self.call(origin="https://untrusted.invalid")[0], 403)
        status, body = self.call()
        self.assertEqual(status, 200)
        self.assertEqual(json.loads(body)["backend"], "norama-independent")
        with self.assertRaises(ValueError):
            n.RuntimeServer(("0.0.0.0", 0), self.client, self.key, "test-model")

    def test_imported_provenance_and_experimental_route_refused(self):
        status,data=self.call(path="/v1/models")
        self.assertEqual(status,200)
        entry=json.loads(data)["models"][0]
        self.assertEqual(entry["provenance"],"imported")
        self.assertFalse(entry["experimental"])
        self.assertFalse(entry["assistant_qualified"])
        self.assertEqual(self.call("POST","/v1/experimental/chat",
                                  {"model_id":"test-model","messages":MESSAGES,"max_tokens":4})[0],404)

    def test_stream_and_nonstream_contract(self):
        body = {"model_id": "test-model", "messages": MESSAGES, "max_tokens": 4, "stream": True}
        status, data = self.call("POST", "/v1/chat", body)
        self.assertEqual(status, 200)
        self.assertIn(b"event: token", data)
        self.assertIn(b"data: [DONE]", data)
        body["stream"] = False
        status, data = self.call("POST", "/v1/chat", body)
        self.assertEqual(status, 200)
        self.assertEqual(json.loads(data)["text"], "Hi \U0001f30c")

    def test_model_unsupported_fields_json_types(self):
        base = {"model_id": "test-model", "messages": MESSAGES, "max_tokens": 4}
        for changes in [{"model_id": "missing"}, {"tools": []}, {"max_tokens": True}, {"stream": "yes"},
                        {"json_object": True}, {"response_format": {"type": "json_object"}},
                        {"contract_schema": {"const": {}}},
                        {"messages": [{"role": "user", "content": [{"image": "x"}]}]}]:
            self.assertEqual(self.call("POST", "/v1/chat", {**base, **changes})[0], 422)
        for raw in ['{"model_id":"a","model_id":"b"}', '{"x":NaN}', "[]"]:
            self.assertEqual(self.call("POST", "/v1/chat", raw)[0], 422)

    def test_stream_failure_never_emits_done(self):
        body = {"model_id": "test-model", "messages": [{"role": "user", "content": "__error"}], "max_tokens": 4}
        status, data = self.call("POST", "/v1/chat", body)
        self.assertEqual(status, 200)
        self.assertIn(b"event: error", data)
        self.assertNotIn(b"[DONE]", data)


class OwnerPipeTests(unittest.TestCase):
    def test_stop_joins_while_owner_pipe_still_open(self):
        read_fd,write_fd=os.pipe()
        with os.fdopen(read_fd,"rb") as reader,os.fdopen(write_fd,"wb") as writer:
            callback=threading.Event()
            watcher=n.OwnerPipeWatcher(reader,callback.set)
            watcher.start()
            try:
                writer.write(b"lifetime-only");writer.flush()
                time.sleep(0.06)
                watcher.close()
                self.assertFalse(watcher.thread.is_alive())
                self.assertFalse(callback.is_set())
            finally:
                watcher.close()

    def test_actual_pipe_eof_signals_shutdown(self):
        read_fd,write_fd=os.pipe()
        with os.fdopen(read_fd,"rb") as reader,os.fdopen(write_fd,"wb") as writer:
            callback=threading.Event()
            watcher=n.OwnerPipeWatcher(reader,callback.set)
            watcher.start()
            try:
                writer.close()
                self.assertTrue(callback.wait(1))
            finally:
                watcher.close()
            self.assertFalse(watcher.thread.is_alive())

    def test_disk_file_is_not_an_owner_pipe(self):
        root=Path(__file__).resolve().parents[3]
        with tempfile.TemporaryFile(dir=root/"verification") as file:
            with self.assertRaises(ValueError):
                n.OwnerPipeWatcher(file,lambda:None)


if __name__ == "__main__":
    unittest.main()
