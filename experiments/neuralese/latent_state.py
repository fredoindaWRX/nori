"""Nori-owned, bounded research states. No text recurrence, retrieval, or training."""
from dataclasses import dataclass
from datetime import datetime, timezone
from hashlib import sha256
import math
import struct
from typing import Protocol

MAX_HIDDEN_SIZE = 8192

@dataclass(frozen=True)
class AllocationMetadata:
    preferred_device: str = "GPU"
    fallback_device: str = "RAM"
    priority: str = "HIGH"
    evictable: bool = True
    bytes: int = 0
    lifetime: str = "experiment"
    owner: str = "Nori.Neuralese"

@dataclass(frozen=True)
class NoriLatentState:
    model_id: str
    hidden_size: int
    dtype: str
    cycle: int
    source_token_count: int
    created_at: str
    vector: tuple[float, ...]
    vector_hash: str
    metadata: tuple[tuple[str, str], ...]
    allocation: AllocationMetadata

    def __post_init__(self):
        if (type(self.hidden_size) is not int or not 1 <= self.hidden_size <= MAX_HIDDEN_SIZE
            or type(self.cycle) is not int or not 1 <= self.cycle <= 2
            or type(self.source_token_count) is not int or not 1 <= self.source_token_count <= 128
            or self.dtype != "float32" or type(self.vector) is not tuple
            or len(self.vector) != self.hidden_size
            or not isinstance(self.model_id, str) or not self.model_id or len(self.model_id) > 128
            or any(ord(c) < 32 for c in self.model_id)
            or not all(type(x) is float and math.isfinite(x) for x in self.vector)
            or type(self.metadata) is not tuple
            or not all(type(pair) is tuple and len(pair)==2 and all(type(v) is str for v in pair) for pair in self.metadata)
            or type(self.allocation) is not AllocationMetadata or self.allocation.bytes != self.hidden_size * 4):
            raise ValueError("invalid Nori latent state constructor")
        raw=struct.pack(f"<{self.hidden_size}f", *self.vector)
        if sha256(raw).hexdigest()!=self.vector_hash:
            raise ValueError("latent vector hash mismatch")
        try:
            timestamp=datetime.fromisoformat(self.created_at)
        except (ValueError, TypeError):
            raise ValueError("invalid latent timestamp") from None
        if timestamp.tzinfo is None:
            raise ValueError("latent timestamp must include timezone")

    @classmethod
    def from_bytes(cls, raw: bytes, *, model_id: str, hidden_size: int,
                   cycle: int, source_token_count: int):
        if (type(hidden_size) is not int or not 1 <= hidden_size <= MAX_HIDDEN_SIZE
            or type(cycle) is not int or not 1 <= cycle <= 2
            or type(source_token_count) is not int or not 1 <= source_token_count <= 128
            or type(raw) is not bytes or len(raw) != hidden_size * 4
            or not isinstance(model_id, str) or not model_id or len(model_id) > 128
            or any(ord(c) < 32 for c in model_id)):
            raise ValueError("invalid bounded Nori latent state")
        vector = struct.unpack(f"<{hidden_size}f", raw)
        if not all(math.isfinite(x) for x in vector):
            raise ValueError("nonfinite Nori latent state")
        return cls(model_id, hidden_size, "float32", cycle, source_token_count,
                   datetime.now(timezone.utc).isoformat(), vector, sha256(raw).hexdigest(),
                   (("backend", "norama-independent"), ("layer", "final_output_norm"),
                    ("source_device", "cuda:0"), ("storage_device", "RAM")),
                   AllocationMetadata(bytes=len(raw)))

    @property
    def norm(self):
        return math.sqrt(math.fsum(x * x for x in self.vector))

    def cosine(self, other):
        if (self.model_id, self.hidden_size, self.dtype) != (other.model_id, other.hidden_size, other.dtype):
            raise ValueError("incompatible latent spaces")
        if not self.norm or not other.norm:
            raise ValueError("zero vector has undefined cosine")
        value=math.fsum(a * b for a, b in zip(self.vector, other.vector)) / (self.norm * other.norm)
        return min(1.0,max(-1.0,value))

class NoriNeuraleseController(Protocol):
    """Future interface only; no fabricated controller weights or subsystem integration."""
    def transform(self, state: NoriLatentState, *, goal_latent=None,
                  working_memory_latent=None, retrieval_vectors=None, perception_vectors=None,
                  world_model_state=None, personality_vector=None, affect_vector=None,
                  uncertainty=None, cognitive_budget=None): ...

@dataclass(frozen=True)
class ControllerResult:
    """Future typed result only; no controller implementation or trained weights."""
    updated_state: NoriLatentState
    continue_score: float
    stop_score: float
    memory_request: object = None
    tool_request: object = None
    final_decode_ready: bool = False
