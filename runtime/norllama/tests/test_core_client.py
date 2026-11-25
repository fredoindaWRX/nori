import json
from pathlib import Path
import sys
import threading
import sqlite3
import tempfile
import http.client
from types import SimpleNamespace
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from core_client import NativeInferenceClient, NativeInferenceError, NativeInferenceCancelled


class ClientTests(unittest.TestCase):
    def setUp(self):
        owner = self
        self.calls = []
        self.status = 200
        self.stream = None
        self.raw_response = None
        self.result = {'model_id': 'fixture', 'text': 'hello', 'metrics':
                       {'finish_reason': 'stop', 'output_tokens': 1, 'prompt_tokens': 4}}
        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *args): pass
            def do_POST(self):
                body = json.loads(self.rfile.read(int(self.headers['Content-Length'])))
                owner.calls.append((self.path, self.headers['Authorization'], body))
                self.send_response(owner.status)
                if owner.stream is not None:
                    self.send_header('X-Nori-Request-ID', '7')
                self.end_headers()
                self.wfile.write(owner.stream if owner.stream is not None else
                    owner.raw_response if owner.raw_response is not None else json.dumps(owner.result).encode())
        self.server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.key = 'x' * 32
        self.client = NativeInferenceClient(f'http://127.0.0.1:{self.server.server_port}', self.key, 'fixture')
    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join()
    def test_native_contract(self):
        answer = self.client.generate([{'role': 'user', 'content': 'hello'}], 4)
        self.assertFalse(answer['fallback'])
        self.assertEqual(self.calls[0][0], '/v1/chat')
        self.assertEqual(self.calls[0][1], 'Bearer ' + self.key)
        self.assertEqual(self.calls[0][2]['model_id'], 'fixture')
        self.assertFalse(self.calls[0][2]['stream'])
    def test_duplicate_and_nonfinite_response_values_refused(self):
        for raw in (b'{"ready":false,"ready":true}', b'{"nested":{"key":0,"key":1}}',
                    b'{"value":NaN}', b'{"value":Infinity}'):
            self.raw_response = raw
            with self.subTest(raw=raw), self.assertRaises(NativeInferenceError):
                self.client._request('/v1/chat', {})
    def test_cancelled_before_dispatch_never_sends_request(self):
        cancelled = threading.Event()
        cancelled.set()
        with self.assertRaises(NativeInferenceCancelled):
            self.client.generate([{'role': 'user', 'content': 'hello'}], cancel_event=cancelled)
        self.assertEqual(self.calls, [])
    def test_cancellable_stream_requires_owned_metrics_and_completion(self):
        self.stream = (b': keepalive\n\n\n'
                       b'event: token\ndata: {"text":"hello"}\n\n'
                       b'event: metrics\ndata: {"request_id":7,"finish_reason":"stop","output_tokens":1,"prompt_tokens":4}\n\n'
                       b'event: done\ndata: [DONE]\n\n')
        answer = self.client.generate([{'role': 'user', 'content': 'hello'}], 4, cancel_event=threading.Event())
        self.assertEqual(answer['text'], 'hello')
        self.assertTrue(self.calls[0][2]['stream'])
        self.stream = b'event: token\ndata: {"text":"partial"}\n\n'
        with self.assertRaisesRegex(NativeInferenceError, 'before completion'):
            self.client.generate([{'role': 'user', 'content': 'hello'}], 4, cancel_event=threading.Event())
        self.stream = b'event: metrics\ndata: {"request_id":8,"state":"started"}\n\n'
        with self.assertRaisesRegex(NativeInferenceError, 'ownership'):
            self.client.generate([{'role': 'user', 'content': 'hello'}], 4, cancel_event=threading.Event())
    def test_invalid_inputs_do_not_dispatch(self):
        for limit in [True, 0, 2049]:
            with self.assertRaises(ValueError): self.client.generate([{'role': 'user', 'content': 'hi'}], limit)
        with self.assertRaises(ValueError): self.client.generate([{'role': 'user', 'content': 'hi'}], model_id='qwen')
        with self.assertRaises(ValueError): self.client.generate([{'role': 'user', 'content': 'hi', 'image': 'data'}])
        self.assertEqual(self.calls, [])
    def test_redirect_and_failure_have_no_retry_or_private_body(self):
        self.status = 302
        self.result = {'error': 'PRIVATE_PROMPT'}
        with self.assertRaisesRegex(NativeInferenceError, '302') as error:
            self.client.generate([{'role': 'user', 'content': 'hi'}])
        self.assertNotIn('PRIVATE_PROMPT', str(error.exception))
        self.assertEqual(len(self.calls), 1)
    def test_mismatched_model_rejected(self):
        self.result['model_id'] = 'other'
        with self.assertRaises(NativeInferenceError): self.client.generate([{'role': 'user', 'content': 'hi'}])
    def test_invalid_metrics_rejected(self):
        self.result['metrics']['output_tokens'] = True
        with self.assertRaises(NativeInferenceError): self.client.generate([{'role': 'user', 'content': 'hi'}])
    def test_remote_endpoint_rejected(self):
        with self.assertRaises(ValueError): NativeInferenceClient('http://example.com:80', self.key, 'fixture')
    def test_core_boot_refuses_implicit_assignments_or_rollback(self):
        sys.path.insert(0, str(Path(__file__).resolve().parents[3] / 'nori'))
        from native_inference import configure_native_inference
        config = {'knights': {'architect': {}, 'machine': {}}}
        with self.assertRaises(ValueError): configure_native_inference(config, {'NORI_INFERENCE_RUNTIME': 'norllama'})
        config['native_inference'] = {'model_id': 'fixture', 'assignments': {'architect': 'fixture'}}
        with self.assertRaises(ValueError): configure_native_inference(config, {})
        with self.assertRaises(ValueError): configure_native_inference(config, {'NORI_INFERENCE_RUNTIME': 'ollama-rollback'})
    def test_native_knight_health_requires_local_host_origin_and_credential(self):
        sys.path.insert(0, str(Path(__file__).resolve().parents[3] / 'nori'))
        from main import handler, CouncilHTTPServer
        health_calls = []
        def health():
            health_calls.append(True)
            return {'ready': True}
        worker = SimpleNamespace(knight='architect', spec={'tools': []},
                                 native_inference=SimpleNamespace(health=health))
        server = CouncilHTTPServer(('127.0.0.1', 0), handler(worker, self.key))
        thread = threading.Thread(target=server.serve_forever, kwargs={'poll_interval': 0.01})
        thread.start()
        def request(headers):
            connection = http.client.HTTPConnection('127.0.0.1', server.server_port, timeout=3)
            try:
                connection.request('GET', '/health', headers=headers)
                response = connection.getresponse()
                response.read()
                return response.status
            finally: connection.close()
        try:
            self.assertEqual(request({}), 401)
            self.assertEqual(request({'Authorization': 'Bearer wrong'}), 401)
            self.assertEqual(request({'Authorization': 'Bearer ' + self.key, 'Host': 'example.com'}), 403)
            self.assertEqual(request({'Authorization': 'Bearer ' + self.key, 'Origin': 'https://example.com'}), 403)
            self.assertEqual(request({'Authorization': 'Bearer ' + self.key, 'Sec-Fetch-Site': 'cross-site'}), 403)
            self.assertEqual(health_calls, [])
            self.assertEqual(request({'Authorization': 'Bearer ' + self.key}), 200)
            self.assertEqual(len(health_calls), 1)
        finally:
            server.shutdown()
            server.server_close()
            thread.join(timeout=3)
            self.assertFalse(thread.is_alive())
    def test_sentinel_audit_context_closes_on_success_and_failure(self):
        root = Path(__file__).resolve().parents[3]
        sys.path.insert(0, str(root / 'nori'))
        from council_gateway import SentinelGate
        with tempfile.TemporaryDirectory(prefix='.audit-close-test-', dir=root / 'verification') as state:
            gate = SentinelGate(self.key, Path(state) / 'audit.sqlite3')
            with gate.connect() as connection:
                connection.execute('SELECT 1')
            with self.assertRaises(sqlite3.ProgrammingError): connection.execute('SELECT 1')
            with self.assertRaises(RuntimeError):
                with gate.connect() as failed:
                    raise RuntimeError('fixture rollback')
            with self.assertRaises(sqlite3.ProgrammingError): failed.execute('SELECT 1')


if __name__ == '__main__': unittest.main()
