"""NORI inference adapter contracts and optional direct llama.cpp bridge."""
from dataclasses import dataclass
from typing import Protocol
import os, shutil, subprocess
import json, secrets, socket, tempfile, time
from urllib.request import Request, urlopen
from urllib.error import URLError
from pathlib import Path
from threading import RLock

GiB = 1024 ** 3
MiB = 1024 ** 2

class ModelAdmissionError(RuntimeError):
    """Raised before an unsafe local model process is started."""

def memory_plan(model_file_bytes: int, memory: dict, context_tokens: int = 2048) -> dict:
    """Conservative, inspectable CPU inference admission plan.

    File size alone is not a safe promise: the runtime, context cache, and the
    operating system need memory too. The plan deliberately leaves a fixed
    system reserve and reports unknown measurements rather than guessing.
    """
    if type(model_file_bytes) is not int or model_file_bytes < 1:
        raise ValueError('model_file_bytes must be a positive integer')
    if type(context_tokens) is not int or not 128 <= context_tokens <= 32768:
        raise ValueError('context_tokens must be 128..32768')
    available = memory.get('available_bytes') if isinstance(memory, dict) else None
    runtime_overhead = max(512 * MiB, (model_file_bytes + 9) // 10)
    # CPU-side context/cache estimate. It is conservative enough to protect the
    # current 2k context setting and scales transparently with future settings.
    context_reserve = max(256 * MiB, ((context_tokens + 511) // 512) * 128 * MiB)
    system_reserve = 1536 * MiB
    required = model_file_bytes + runtime_overhead + context_reserve + system_reserve
    if type(available) is not int or available < 0:
        decision = 'measurement_unavailable'
        headroom = None
    else:
        headroom = available - required
        decision = 'admitted' if headroom >= 0 else 'rejected_insufficient_available_ram'
    return {
        'context_tokens': context_tokens,
        'model_file_bytes': model_file_bytes,
        'runtime_overhead_bytes': runtime_overhead,
        'context_reserve_bytes': context_reserve,
        'system_reserve_bytes': system_reserve,
        'estimated_required_bytes': required,
        'available_bytes': available,
        'headroom_bytes': headroom,
        'decision': decision,
    }

@dataclass
class GenerationRequest:
    model: str
    prompt: str
    max_tokens: int = 256
    history: list[dict[str, str]] | None = None

class InferenceAdapter(Protocol):
    name: str
    def available(self) -> bool: ...
    def generate(self, request: GenerationRequest) -> str: ...

class UnconfiguredAdapter:
    name = "unconfigured"
    def available(self): return False
    def generate(self, request): raise RuntimeError("no licensed inference adapter is configured")

class LlamaCppAdapter:
    """NORI-owned process adapter; llama.cpp remains an optional external engine."""
    name = "llama.cpp"
    def __init__(self, executable=None, model_dir=None):
        self.executable=executable or os.getenv("NORI_LLAMA_SERVER", "llama-server")
        self.model_dir=model_dir or os.getenv("NORI_MODEL_DIR", "")
        self._lock=RLock()
        self._process=None
        self._loaded_model=None
        self._diagnostics=None
    def models(self):
        root=Path(self.model_dir).resolve() if self.model_dir else None
        return sorted(p.name for p in root.glob('*.gguf') if p.is_file() and p.resolve().parent == root) if root and root.is_dir() else []
    def available(self): return bool(shutil.which(self.executable) and self.models())
    def preflight(self, model):
        """Read-only planning data, without starting or stopping an engine."""
        from hardware.nori_hal import memory_status
        if not isinstance(model, str) or model not in self.models():
            raise ValueError('unknown model')
        size = (Path(self.model_dir) / model).stat().st_size
        memory = memory_status()
        plan = memory_plan(size, memory)
        return {'model': model, 'memory': memory,
                'engine_configured': bool(shutil.which(self.executable)),
                'runtime': self.status(), 'gpu_layers': 0,
                'admission_enforced': True, 'plan': plan,
                'unaccounted': ['model-specific KV dimensions', 'container_limits',
                                'concurrent non-NORI workloads']}
    def status(self):
        if not self._lock.acquire(blocking=False):
            return {"state":"busy", "loaded_model":None, "adapter":self.name}
        try:
            alive = self.engine_pid is not None
            return {"state":"loaded" if alive and self._loaded_model else "unloaded",
                    "loaded_model":self._loaded_model if alive else None, "adapter":self.name}
        finally:
            self._lock.release()

    def _require_admission(self, model):
        plan = self.preflight(model)['plan']
        if plan['decision'] != 'admitted':
            raise ModelAdmissionError('model rejected by NORI memory policy: ' + plan['decision'])
        return plan

    def load(self, model):
        with self._lock:
            if model not in self.models(): raise ValueError("unknown model")
            if not self.available(): raise RuntimeError("llama.cpp adapter is not configured")
            self._require_admission(model)
            self._ensure_engine(model)
            return self.status()

    @property
    def engine_pid(self):
        return self._process.pid if self._process and self._process.poll() is None else None

    def close(self):
        with self._lock:
            if self._process and self._process.poll() is None:
                self._process.terminate()
                try: self._process.wait(timeout=5)
                except subprocess.TimeoutExpired: self._process.kill(); self._process.wait()
            self._process=None
            self._loaded_model=None
            if self._diagnostics: self._diagnostics.close(); self._diagnostics=None

    def _health(self):
        if not self.engine_pid: return False
        try:
            req=Request(self._base+"/health",headers={"Authorization":"Bearer "+self._key})
            with urlopen(req,timeout=2) as response: return json.load(response).get("status")=="ok"
        except (URLError,TimeoutError,ValueError): return False

    def _ensure_engine(self, model):
        if self._loaded_model==model and self._health(): return
        self.close()
        with socket.socket() as probe:
            probe.bind(("127.0.0.1",0)); port=probe.getsockname()[1]
        self._key=secrets.token_urlsafe(32)
        self._base=f"http://127.0.0.1:{port}"
        command=[self.executable,"-m",str(Path(self.model_dir)/model),"--host","127.0.0.1",
                 "--port",str(port),"--ctx-size","2048","--gpu-layers","0","--parallel","1","--api-key",self._key]
        self._diagnostics=tempfile.TemporaryFile()
        try:
            self._process=subprocess.Popen(command,stdout=self._diagnostics,stderr=self._diagnostics,
                creationflags=getattr(subprocess,"CREATE_NO_WINDOW",0))
            deadline=time.monotonic()+120
            while not self._health():
                if self._process.poll() is not None: raise RuntimeError("model engine exited during startup")
                if time.monotonic()>=deadline: raise subprocess.TimeoutExpired("NORI engine startup",120)
                time.sleep(.2)
            self._loaded_model=model
        except Exception:
            self.close()
            raise

    def generate(self, request):
        with self._lock:
            if not self.available(): raise RuntimeError("llama.cpp adapter is not configured")
            if request.model not in self.models(): raise ValueError("unknown model")
            if type(request.max_tokens) is not int or not 1 <= request.max_tokens <= 4096: raise ValueError("max_tokens must be 1..4096")
            self._require_admission(request.model)
            self._ensure_engine(request.model)
            payload={"messages":[*(request.history or []), {"role":"user","content":request.prompt}],
                     "max_tokens":request.max_tokens,"stream":False,"temperature":0}
            req=Request(self._base+"/v1/chat/completions",data=json.dumps(payload).encode(),
                headers={"Content-Type":"application/json","Authorization":"Bearer "+self._key})
            try:
                with urlopen(req,timeout=120) as response: result=json.load(response)
                content=result["choices"][0]["message"]["content"]
                if not isinstance(content,str): raise ValueError("invalid engine content")
                return content
            except TimeoutError:
                self.close()
                raise subprocess.TimeoutExpired("NORI generation",120)
            except Exception as error:
                self.close()
                raise RuntimeError("model generation failed") from error
