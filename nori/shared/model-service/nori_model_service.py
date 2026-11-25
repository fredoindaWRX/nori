"""NORI-native local model service foundation.

This service owns the NORI API surface; inference engines are adapters selected by policy.
Inference requires a configured engine and model. Lifecycle operations share the
generation slot so a load/unload request cannot interrupt an active generation.
"""
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json, os, platform, time, sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from hardware.nori_hal import snapshot
from audit.nori_audit import record, read
from adapters import LlamaCppAdapter, GenerationRequest, ModelAdmissionError
import atexit
ADAPTER=LlamaCppAdapter()
atexit.register(ADAPTER.close)
import subprocess
from threading import BoundedSemaphore
GENERATION_SLOT=BoundedSemaphore(1)
AUDIT_PATH=Path(os.getenv("NORI_AUDIT_PATH", str(Path(__file__).resolve().parents[2] / "Logs" / "runtime-audit.jsonl")))

class Handler(BaseHTTPRequestHandler):
    def _local_request(self):
        """Reject DNS rebinding and cross-site browser requests to loopback."""
        expected = f"127.0.0.1:{self.server.server_port}"
        return (self.headers.get("Host") == expected
                and self.headers.get("Origin", f"http://{expected}") == f"http://{expected}"
                and self.headers.get("Sec-Fetch-Site", "same-origin") in ("same-origin", "none"))

    def _failure(self, action, model, reason, code):
        try:
            record(AUDIT_PATH,action,'model-service',outcome='failed',
                   details={'model':model,'reason':reason})
        except OSError:
            self._send({'error':'audit_unavailable','operation_error':reason},503)
            return
        self._send({'error':reason},code)
    def _send(self, payload, code=200):
        raw=json.dumps(payload).encode(); self.send_response(code)
        self.send_header("Content-Type","application/json"); self.send_header("Content-Length",str(len(raw)))
        self.send_header("Cache-Control","no-store"); self.send_header("X-Content-Type-Options","nosniff")
        self.send_header("X-Frame-Options","DENY"); self.end_headers(); self.wfile.write(raw)
    def do_GET(self):
        if not self._local_request():
            self._send({"error":"local_origin_required"},403); return
        if self.path == "/health": self._send({"service":"nori-model-service","status":"ready","platform":platform.platform()})
        elif self.path == "/v1/models":
            adapter=ADAPTER
            self._send({"data":[{"id":name,"state":"discovered","engine":adapter.name} for name in adapter.models()]})
        elif self.path == "/policy": self._send({"max_workers":int(os.getenv("NORI_MAX_WORKERS","1")),"allow_network":False,"audit_required":True})
        elif self.path == "/v1/capabilities":
            adapter=ADAPTER; ready=adapter.available()
            self._send({"chat":ready,"streaming":False,"gpu":False,"adapter":adapter.name if ready else "unconfigured"})
        elif self.path == "/hardware": self._send(snapshot())
        elif self.path == "/v1/runtime": self._send(ADAPTER.status())
        elif self.path == "/audit": self._send({"events":read(AUDIT_PATH)[-50:]})
        else: self._send({"error":"not_found"},404)
    def do_POST(self):
        if not self._local_request():
            self._send({"error":"local_origin_required"},403); return
        if self.path not in ("/v1/chat", "/v1/chat/completions", "/v1/responses",
                             "/v1/models/load", "/v1/models/unload", "/v1/models/preflight"):
            self._send({"error":"not_found"},404); return
        if self.headers.get("Transfer-Encoding") is not None or self.headers.get("Content-Type") != "application/json":
            self._send({"error":"json_body_required"},400); return
        try:
            lengths=self.headers.get_all("Content-Length", [])
            if len(lengths) != 1 or not lengths[0].isascii() or not lengths[0].isdigit():
                self._send({"error":"invalid_content_length"},400); return
            length=int(lengths[0])
            if not 0 < length <= 65536:
                self._send({"error":"invalid_body_size"},413); return
            body=json.loads(self.rfile.read(length))
        except (ValueError, UnicodeError):
            self._send({"error":"invalid_json"},400); return
        if self.path == '/v1/models/preflight':
            if not isinstance(body, dict) or set(body) != {'model'}:
                self._send({'error':'invalid_preflight_request'},400); return
            try:
                self._send(ADAPTER.preflight(body['model']))
            except ValueError:
                self._send({'error':'unknown_model'},400)
            except OSError:
                self._send({'error':'model_unreadable'},409)
            return
        if self.path in ("/v1/chat/completions", "/v1/responses"):
            self._openai_compatible_chat(body)
            return
        if self.path != "/v1/chat":
            self._lifecycle(body)
            return
        if not isinstance(body,dict) or not isinstance(body.get("prompt"),str) or not body["prompt"].strip():
            self._send({"error":"prompt_required"},400); return
        tokens=body.get("max_tokens",256)
        history=body.get('history', [])
        # Complete pairs only: failed requests never become assistant history.
        if (not isinstance(history,list) or len(history)>32 or len(history)%2
            or any(not isinstance(turn,dict) or set(turn)!={'role','content'}
                   or turn.get('role') != ('user' if index%2==0 else 'assistant')
                   or not isinstance(turn.get('content'),str) or not turn['content'].strip()
                   for index,turn in enumerate(history))):
            self._send({'error':'invalid_history'},400); return
        if type(tokens) is not int or not 1 <= tokens <= 4096:
            self._send({"error":"invalid_max_tokens"},400); return
        adapter=ADAPTER
        if not adapter.available():
            self._send({"error":"inference_unavailable"},503); return
        model=body.get("model",os.getenv("NORI_DEFAULT_MODEL"))
        if model is None and len(adapter.models())==1: model=adapter.models()[0]
        if not isinstance(model,str) or model not in adapter.models():
            self._send({"error":"unknown_model","message":"Choose an id from /v1/models"},400); return
        if not GENERATION_SLOT.acquire(blocking=False):
            self._send({"error":"inference_busy"},429); return
        try:
            record(AUDIT_PATH,"chat","model-service",outcome="started",details={"model":model,"prompt_length":len(body["prompt"])})
            output=adapter.generate(GenerationRequest(model,body["prompt"],tokens,history))
            record(AUDIT_PATH,"chat","model-service",outcome="completed",details={"model":model})
            self._send({"model":model,"response":output})
        except ModelAdmissionError:
            self._failure('chat',model,'model_rejected_by_memory_policy',409)
        except subprocess.TimeoutExpired:
            self._failure('chat',model,'inference_timeout',504)
        except (OSError,RuntimeError,ValueError):
            self._failure('chat',model,'inference_failed',502)
        finally:
            GENERATION_SLOT.release()

    def _openai_compatible_chat(self, body):
        """Serve a small, explicit OpenAI-shaped local compatibility surface.

        NORI owns this public contract.  The adapter remains a policy-selected
        local engine, so callers do not need to change when an Ollama bridge is
        replaced by Seth's direct llama.cpp engine.  Streaming and tools are
        deliberately not claimed here until NORI implements them end to end.
        """
        if not isinstance(body, dict):
            self._send({"error": "invalid_request"}, 400)
            return
        messages = body.get("messages")
        if self.path == "/v1/responses":
            value = body.get("input")
            if isinstance(value, str) and value.strip():
                messages = [{"role": "user", "content": value}]
            else:
                self._send({"error": "input_required"}, 400)
                return
        if (not isinstance(messages, list) or not 1 <= len(messages) <= 33
                or any(not isinstance(item, dict) or set(item) - {"role", "content"}
                       or item.get("role") not in ("system", "user", "assistant")
                       or not isinstance(item.get("content"), str) or not item["content"].strip()
                       for item in messages)):
            self._send({"error": "invalid_messages"}, 400)
            return
        if messages[-1]["role"] != "user":
            self._send({"error": "last_message_must_be_user"}, 400)
            return
        model = body.get("model", os.getenv("NORI_DEFAULT_MODEL"))
        tokens = body.get("max_tokens", body.get("max_output_tokens", 256))
        if type(tokens) is not int or not 1 <= tokens <= 4096:
            self._send({"error": "invalid_max_tokens"}, 400)
            return
        adapter = ADAPTER
        if not adapter.available():
            self._send({"error": "inference_unavailable"}, 503)
            return
        if model is None and len(adapter.models()) == 1:
            model = adapter.models()[0]
        if not isinstance(model, str) or model not in adapter.models():
            self._send({"error": "unknown_model", "message": "Choose an id from /v1/models"}, 400)
            return
        system = [item["content"] for item in messages if item["role"] == "system"]
        conversation = [item for item in messages if item["role"] != "system"]
        prior, current = conversation[:-1], conversation[-1]["content"]
        if (len(prior) % 2 or any(item["role"] != ("user" if index % 2 == 0 else "assistant")
                                  for index, item in enumerate(prior))):
            self._send({"error": "invalid_message_sequence"}, 400)
            return
        prompt = ("\n\n".join(system) + "\n\n" if system else "") + current
        if not GENERATION_SLOT.acquire(blocking=False):
            self._send({"error": "inference_busy"}, 429)
            return
        try:
            record(AUDIT_PATH, "openai_compat_chat", "model-service", outcome="started",
                   details={"model": model, "prompt_length": len(prompt)})
            output = adapter.generate(GenerationRequest(model, prompt, tokens, prior))
            record(AUDIT_PATH, "openai_compat_chat", "model-service", outcome="completed",
                   details={"model": model})
            created = int(time.time())
            if self.path == "/v1/chat/completions":
                self._send({"id": "chatcmpl-nori-" + str(created), "object": "chat.completion",
                            "created": created, "model": model,
                            "choices": [{"index": 0, "message": {"role": "assistant", "content": output},
                                         "finish_reason": "stop"}],
                            "usage": {"prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0},
                            "nori": {"local": True, "streaming": False, "engine": adapter.name}})
            else:
                self._send({"id": "resp-nori-" + str(created), "object": "response",
                            "created_at": created, "status": "completed", "model": model,
                            "output": [{"type": "message", "role": "assistant", "content": [
                                {"type": "output_text", "text": output}]}],
                            "output_text": output,
                            "nori": {"local": True, "streaming": False, "engine": adapter.name}})
        except ModelAdmissionError:
            self._failure("openai_compat_chat", model, "model_rejected_by_memory_policy", 409)
        except subprocess.TimeoutExpired:
            self._failure("openai_compat_chat", model, "inference_timeout", 504)
        except (OSError, RuntimeError, ValueError):
            self._failure("openai_compat_chat", model, "inference_failed", 502)
        finally:
            GENERATION_SLOT.release()
    def _lifecycle(self, body):
        loading = self.path == "/v1/models/load"
        allowed = {"model"} if loading else set()
        if not isinstance(body,dict) or set(body) != allowed:
            self._send({"error":"invalid_lifecycle_request"},400); return
        model = body.get("model")
        if loading and (not isinstance(model,str) or model not in ADAPTER.models()):
            self._send({"error":"unknown_model"},400); return
        if loading and not ADAPTER.available():
            self._send({"error":"inference_unavailable"},503); return
        if not GENERATION_SLOT.acquire(blocking=False):
            self._send({"error":"inference_busy"},429); return
        action = "model_load" if loading else "model_unload"
        try:
            record(AUDIT_PATH,action,"model-service",outcome="started",details={"model":model})
            if loading: ADAPTER.load(model)
            else: ADAPTER.close()
            record(AUDIT_PATH,action,"model-service",outcome="completed",details={"model":model})
            self._send(ADAPTER.status())
        except ModelAdmissionError:
            self._failure(action,model,'model_rejected_by_memory_policy',409)
        except subprocess.TimeoutExpired:
            self._failure(action,model,'inference_timeout',504)
        except (OSError,RuntimeError,ValueError):
            self._failure(action,model,'lifecycle_failed',502)
        finally:
            GENERATION_SLOT.release()
    def log_message(self, *_): pass

if __name__ == "__main__":
    import signal
    def stop_service(signum, frame):
        raise SystemExit(0)
    signal.signal(signal.SIGTERM, stop_service)
    port=int(os.getenv("NORI_MODEL_PORT","9391")); print(f"NORI model service listening on 127.0.0.1:{port}", flush=True)
    server=ThreadingHTTPServer(("127.0.0.1",port),Handler)
    try: server.serve_forever()
    finally:
        server.server_close()
        ADAPTER.close()






