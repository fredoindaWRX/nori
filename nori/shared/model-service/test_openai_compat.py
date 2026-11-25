"""NORI's local OpenAI-shaped API stays local and returns real adapter output."""
import json
import tempfile
import threading
import unittest
from pathlib import Path
from unittest.mock import patch
from http.server import ThreadingHTTPServer
from urllib.request import Request, urlopen
from urllib.error import HTTPError
import nori_model_service as service


class Adapter:
    name = "fixture"
    def available(self): return True
    def models(self): return ["nori-code-test"]
    def generate(self, request):
        self.request = request
        return "local answer"


class OpenAICompatibilityTests(unittest.TestCase):
    def setUp(self):
        self.adapter = Adapter()
        self.temp = tempfile.TemporaryDirectory()
        self.patch = patch.object(service, "ADAPTER", self.adapter)
        self.audit = patch.object(service, "AUDIT_PATH", Path(self.temp.name) / "audit.jsonl")
        self.patch.start(); self.audit.start()
        self.server = ThreadingHTTPServer(("127.0.0.1", 0), service.Handler)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()

    def tearDown(self):
        self.server.shutdown(); self.server.server_close(); self.thread.join()
        self.audit.stop(); self.patch.stop(); self.temp.cleanup()

    def post(self, path, body):
        request = Request(f"http://127.0.0.1:{self.server.server_port}{path}",
                          data=json.dumps(body).encode(), headers={"Content-Type": "application/json"})
        with urlopen(request, timeout=3) as response:
            return json.load(response)

    def test_chat_completions_maps_messages_to_local_adapter(self):
        result = self.post("/v1/chat/completions", {"model": "nori-code-test", "max_tokens": 32,
                           "messages": [{"role": "system", "content": "Be brief."},
                                        {"role": "user", "content": "Write a test."}]})
        self.assertEqual(result["choices"][0]["message"]["content"], "local answer")
        self.assertTrue(result["nori"]["local"])
        self.assertEqual(self.adapter.request.model, "nori-code-test")
        self.assertIn("Be brief.", self.adapter.request.prompt)

    def test_responses_maps_input_to_local_adapter(self):
        result = self.post("/v1/responses", {"model": "nori-code-test", "input": "Hello"})
        self.assertEqual(result["output_text"], "local answer")
        self.assertEqual(result["object"], "response")

    def test_rejects_non_user_final_message(self):
        with self.assertRaises(HTTPError) as failure:
            self.post("/v1/chat/completions", {"model": "nori-code-test",
                      "messages": [{"role": "assistant", "content": "No."}]})
        self.assertEqual(failure.exception.code, 400)


if __name__ == "__main__":
    unittest.main()
