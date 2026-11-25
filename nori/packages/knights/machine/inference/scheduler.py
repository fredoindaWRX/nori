"""Single-model scheduler for NORI's 16 GB GPU.

NORI must never keep two heavyweight model tiers resident at once on this RTX
4080 Super. This module serializes inference across the dispatch tiers:

- Parallel tasks on the SAME tier may share the resident model.
- A DIFFERENT tier must wait, then the scheduler unloads every non-target Ollama
  model with ``keep_alive: 0``, verifies ``/api/ps`` no longer reports it, and
  only then invokes the target tier.
- The scheduler lock is never held while waiting on a task result or a
  notification callback that can re-enter the scheduler.
- Queued cancellation removes the request without touching the resident model;
  cancellation during generation stops that request's subsequent tier switch.
- Explicit GPU OOM gets exactly one bounded CPU retry and raises a structured
  Architect event. Non-OOM errors are never retried, and a failed CPU fallback
  remains a failure.

It never talks to the network: the Ollama backend is always an injectable
callable, so tests are fully deterministic and no live Ollama call or model
download is performed.
"""
from __future__ import annotations

import threading
import time
from typing import Any, Callable

from .oom_handler import BackendError, OOMHandler

# The three dispatch tiers NORI is sized for on this GPU. No other tier is
# schedulable here.
DISPATCH_TIERS: tuple[str, ...] = ("coder_14b", "rag_12b", "general_8b")

# Ollama model that backs each tier. These mirror the reviewed local assignment
# (14b coder, 12b retrieval/vision, gpt-oss 20b general) and match installed models.
TIER_MODELS: dict[str, str] = {
    "coder_14b": "qwen2.5-coder:14b",
    "rag_12b": "gemma4:12b",
    "general_8b": "gpt-oss-20b-32k",
}


class SchedulerCancelled(RuntimeError):
    """Raised inside a task when its request was cancelled before it ran."""


class SchedulerClosed(RuntimeError):
    """Raised when a request is submitted after the scheduler is closed."""

_REDACTED_FIELDS = frozenset(
    {"prompt", "messages", "response", "content", "output", "text", "system",
     "context", "token", "api_key", "key", "secret"}
)


def _redact(value: Any) -> Any:
    """Strip anything that could be a prompt, credential or model output."""
    if isinstance(value, dict):
        return {
            key: "<redacted>" if key in _REDACTED_FIELDS else _redact(item)
            for key, item in value.items()
        }
    if isinstance(value, (list, tuple)):
        return [_redact(item) for item in value]
    return value


class ModelScheduler:
    """Serialize model-tier inference so only one heavyweight tier is resident."""

    def __init__(
        self,
        backend: Callable[[str, dict[str, Any]], dict[str, Any]] | None = None,
        notify: Callable[[dict[str, Any]], None] | None = None,
        *,
        unload_timeout_seconds: float = 30.0,
        tier_models: dict[str, str] | None = None,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        if backend is not None and not callable(backend):
            raise ValueError("backend must be callable")
        if notify is not None and not callable(notify):
            raise ValueError("notify must be callable")
        if unload_timeout_seconds <= 0:
            raise ValueError("unload_timeout_seconds must be positive")
        models = dict(TIER_MODELS if tier_models is None else tier_models)
        if set(models) != set(DISPATCH_TIERS) or any(
            not isinstance(name, str) or not name for name in models.values()
        ):
            raise ValueError("tier_models must map every dispatch tier to a model name")
        self._backend = backend
        self._tier_models = models
        self._unload_timeout = float(unload_timeout_seconds)
        self._clock = clock
        # Guards only queue/state; never held during a backend call or notify.
        self._state_lock = threading.Lock()
        # FIFO order across tiers: the lowest pending sequence is next.
        self._sequence = 0
        self._queued: dict[int, dict[str, Any]] = {}
        self._resident_tier: str | None = None
        self._resident_model: str | None = None
        self._generating = False
        self._generating_sequence: int | None = None
        self._closed = False
        self._work_available = threading.Condition(self._state_lock)
        self._oom = OOMHandler(notify)
        self._notify = notify
        self._last_transition: dict[str, Any] | None = None
        self._cpu_fallback_active = False

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------
    def select_model(self, tier: str) -> str:
        """Return the model for a dispatch tier, or raise for an unknown tier."""
        try:
            return self._tier_models[tier]
        except KeyError as exc:
            raise ValueError(f"unknown dispatch tier: {tier}") from exc

    def submit(
        self,
        tier: str,
        path: str,
        payload: dict[str, Any],
        *,
        task_id: str | None = None,
    ) -> dict[str, Any]:
        """Queue an inference request and block until its result is ready.

        The scheduler injects the tier's model so a caller can never pin a
        second tier into a single request.
        """
        model = self.select_model(tier)
        if not isinstance(path, str) or not path.startswith("/api/"):
            raise ValueError("path must be a local /api/ route")
        if not isinstance(payload, dict):
            raise ValueError("payload must be a mapping")
        with self._state_lock:
            if self._closed:
                raise SchedulerClosed("scheduler is closed")
            sequence = self._sequence
            self._sequence += 1
            self._queued[sequence] = {
                "sequence": sequence,
                "tier": tier,
                "model": model,
                "task_id": task_id,
                "cancelled": False,
                "queued_at": self._clock(),
            }
        return self._coordinator(sequence, path, dict(payload))

    def cancel(self, sequence: int) -> bool:
        """Cancel a queued request. Returns True if it was still queued.

        Cancelling a queued request only removes it; it never changes which
        model is resident. A request already generating is not un-loaded by
        cancellation, but its completion path is suppressed.
        """
        with self._state_lock:
            request = self._queued.get(sequence)
            if request is None:
                return False
            request["cancelled"] = True
            return True

    def model_status(self) -> dict[str, Any]:
        """Residency, per-tier queue counts and last transition, redacted."""
        with self._state_lock:
            queued_by_tier: dict[str, int] = {tier: 0 for tier in DISPATCH_TIERS}
            for request in self._queued.values():
                if not request["cancelled"]:
                    queued_by_tier[request["tier"]] += 1
            return {
                "resident_tier": self._resident_tier,
                "resident_model": self._resident_model,
                "queued": queued_by_tier,
                "generating": self._generating,
                "closed": self._closed,
                "cpu_fallback_active": self._cpu_fallback_active,
                "last_transition": _redact(self._last_transition)
                if self._last_transition
                else None,
                "oom_events": len(self._oom.events),
            }

    def close(self) -> None:
        with self._state_lock:
            self._closed = True
            self._work_available.notify_all()

    # ------------------------------------------------------------------
    # Coordination (never holds the state lock across a backend call)
    # ------------------------------------------------------------------
    def _coordinator(self, sequence: int, path: str, payload: dict[str, Any]) -> dict[str, Any]:
        while True:
            with self._work_available:
                request = self._queued.get(sequence)
                if request is None:
                    raise SchedulerCancelled("request was removed")
                if request["cancelled"]:
                    self._queued.pop(sequence, None)
                    raise SchedulerCancelled("request cancelled while queued")
                blockers = sorted(
                    other for other in self._queued
                    if other < sequence and not self._queued[other]["cancelled"]
                )
                if self._closed:
                    raise SchedulerClosed("scheduler closed before running")
                if not blockers and not self._generating:
                    self._generating = True
                    self._generating_sequence = sequence
                    break
                self._work_available.wait(timeout=0.05)
        try:
            return self._run(sequence, path, payload)
        finally:
            with self._work_available:
                self._generating = False
                self._generating_sequence = None
                self._queued.pop(sequence, None)
                self._work_available.notify_all()

    def _run(self, sequence: int, path: str, payload: dict[str, Any]) -> dict[str, Any]:
        with self._state_lock:
            request = self._queued.get(sequence)
            if request is None or request["cancelled"]:
                raise SchedulerCancelled("request cancelled before generation")
            tier = request["tier"]
            model = request["model"]
            task_id = request["task_id"]

        transitioned = self._ensure_resident(tier, model)

        with self._state_lock:
            request = self._queued.get(sequence)
            if request is None or request["cancelled"]:
                raise SchedulerCancelled("request cancelled during tier transition")

        body = {**payload, "model": model}
        outcome = self._oom.execute(self._call, path, body)
        result = outcome["result"]
        if outcome.get("fallback"):
            with self._state_lock:
                self._cpu_fallback_active = True
        response = {
            "result": result,
            "model": model,
            "model_tier": tier,
            "transitioned": transitioned,
        }
        if task_id is not None:
            response["task_id"] = task_id
        if outcome.get("fallback"):
            response["execution_requested"] = "cpu"
        return response

    def _call(self, path: str, payload: dict[str, Any] | None) -> dict[str, Any]:
        if self._backend is None:
            raise BackendError("no backend configured for live inference")
        return self._backend(path, payload)

    def _ensure_resident(self, tier: str, model: str) -> bool:
        """Make ``model`` the single resident model for ``tier``.

        Returns True if a tier transition occurred. If any unload step fails or
        times out, the prior resident tier stays authoritative and the error
        propagates to the caller.
        """
        with self._state_lock:
            if self._resident_tier == tier and self._resident_model == model:
                return False
            prior_tier = self._resident_tier
            prior_model = self._resident_model

        loaded = self._loaded_models()
        transitioned = False
        non_target = [name for name in loaded if not self._same_model(name, model)]
        if non_target:
            transitioned = True
            self._emit_transition(
                "model_tier_transition",
                from_tier=prior_tier,
                to_tier=tier,
                from_model=prior_model,
                to_model=model,
                stage="unloading",
                unloaded=[],
            )
            unloaded: list[str] = []
            try:
                for name in non_target:
                    self._request_generate(name, keep_alive=0)
                    self._wait_until_unloaded(name)
                    unloaded.append(name)
            except Exception:
                self._emit_transition(
                    "model_tier_transition_failed",
                    from_tier=prior_tier,
                    to_tier=tier,
                    from_model=prior_model,
                    to_model=model,
                    stage="unloading",
                    unloaded=list(unloaded),
                )
                raise
            self._emit_transition(
                "model_tier_transition",
                from_tier=prior_tier,
                to_tier=tier,
                from_model=prior_model,
                to_model=model,
                stage="resident",
                unloaded=unloaded,
            )
        with self._state_lock:
            self._resident_tier = tier
            self._resident_model = model
        return transitioned


    def _loaded_models(self) -> list[str]:
        # Ollama exposes /api/ps as GET. Passing an empty JSON object changes
        # OllamaBackend to POST and the real service rejects it with HTTP 405.
        result = self._call("/api/ps", None)
        models = result.get("models", []) if isinstance(result, dict) else []
        names: list[str] = []
        for item in models:
            if isinstance(item, dict):
                name = item.get("name") or item.get("model")
                if isinstance(name, str) and name:
                    names.append(name)
        return names

    def _request_generate(self, model: str, keep_alive: int) -> None:
        self._call("/api/generate", {"model": model, "keep_alive": keep_alive})

    def _wait_until_unloaded(self, name: str) -> None:
        deadline = self._clock() + self._unload_timeout
        while self._clock() < deadline:
            if all(not self._same_model(name, loaded) for loaded in self._loaded_models()):
                return
            time.sleep(0.01)
        raise BackendError(f"model unload timed out: {name}")

    @staticmethod
    def _same_model(a: str, b: str) -> bool:
        def base(value: str) -> str:
            return value.split(":", 1)[0].casefold()

        return base(a) == base(b)

    def _emit_transition(self, event: str, **fields: Any) -> None:
        record = {
            "destination": "architect",
            "event": event,
            **_redact(fields),
        }
        with self._state_lock:
            self._last_transition = record
        if self._notify is not None:
            try:
                self._notify(dict(record))
            except Exception:
                record["notification_error"] = "notify_failed"

    @property
    def events(self) -> list[dict[str, Any]]:
        return list(self._oom.events)


