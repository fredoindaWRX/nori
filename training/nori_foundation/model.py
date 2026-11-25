"""DualTrace v0: an experimental causal byte model, initialized from scratch.

Own topology/implementation using standard gated recurrence and PyTorch math.
Not a Llama wrapper, not a claim of novel mathematics or assistant capability.
"""
from dataclasses import asdict, dataclass
from hashlib import sha256
import json
import math
from pathlib import Path
import struct

import numpy as np
import torch
from torch import nn

BOS, EOS, VOCAB = 256, 257, 258
MAGIC = b"NORI-DT0"
MAX_CHECKPOINT = 64 * 1024 * 1024
MAX_HEADER = 16384
MAX_WIDTH, MAX_LAYERS = 512, 8


@dataclass(frozen=True)
class Config:
    width: int = 32
    layers: int = 2

    def __post_init__(self):
        if type(self.width) is not int or not 8 <= self.width <= MAX_WIDTH:
            raise ValueError("Development width must be8..512")
        if type(self.layers) is not int or not 1 <= self.layers <= MAX_LAYERS:
            raise ValueError("Development layer count must be1..8")


def parameter_count(config: Config) -> int:
    return 2 * VOCAB * config.width + VOCAB + config.layers * (4 * config.width ** 2 + 6 * config.width)


def encode(text: str) -> list[int]:
    if not isinstance(text, str):
        raise ValueError("Text must be a string")
    return [BOS, *text.encode("utf-8"), EOS]


def decode(tokens: list[int]) -> str:
    if any(type(t) is not int or not 0 <= t < VOCAB for t in tokens):
        raise ValueError("Invalid byte token")
    return bytes(t for t in tokens if t < 256).decode("utf-8", errors="replace")


class DualTrace(nn.Module):
    """Input-gated fast trace + slower learned decay trace; no attention/KV."""
    def __init__(self, width: int):
        super().__init__()
        self.proposal = nn.Linear(width, width)
        self.gate = nn.Linear(width, width)
        self.decay = nn.Parameter(torch.zeros(width))
        self.mix = nn.Linear(2 * width, width)
        self.norm = nn.LayerNorm(width)

    def step(self, value, state):
        fast, slow = state
        proposal = torch.tanh(self.proposal(value))
        gate = torch.sigmoid(self.gate(value))
        decay = 0.8 + 0.199 * torch.sigmoid(self.decay)
        fast = (1 - gate) * fast + gate * proposal
        slow = decay * slow + (1 - decay) * proposal
        result = self.norm(value + torch.tanh(self.mix(torch.cat((fast, slow), dim=-1))))
        return result, (fast, slow)


class NoriModel(nn.Module):
    def __init__(self, config: Config = Config()):
        super().__init__()
        self.config = config
        self.embedding = nn.Embedding(VOCAB, config.width)
        self.traces = nn.ModuleList(DualTrace(config.width) for _ in range(config.layers))
        self.output = nn.Linear(config.width, VOCAB)

    def initial_state(self, batch: int):
        weight = self.embedding.weight
        return tuple((weight.new_zeros(batch, self.config.width),
                      weight.new_zeros(batch, self.config.width)) for _ in self.traces)

    def forward(self, tokens, state=None):
        if tokens.ndim != 2 or tokens.dtype != torch.long or not 1 <= tokens.shape[1] <= 512:
            raise ValueError("Expected batch x 1..512 int64 tokens")
        if not 1 <= tokens.shape[0] <= 16 or bool(((tokens < 0) | (tokens >= VOCAB)).any()):
            raise ValueError("Invalid prototype batch or tokens")
        state = self.initial_state(tokens.shape[0]) if state is None else state
        if len(state) != self.config.layers or any(
            fast.shape != (tokens.shape[0], self.config.width) or slow.shape != fast.shape
            for fast, slow in state
        ):
            raise ValueError("Invalid recurrent state")
        results = []
        for value in self.embedding(tokens).unbind(dim=1):
            next_states = []
            for layer, old_state in zip(self.traces, state):
                value, new_state = layer.step(value, old_state)
                next_states.append(new_state)
            state = tuple(next_states)
            results.append(self.output(value))
        return torch.stack(results, dim=1), state

    @torch.no_grad()
    def generate(self, prompt: str, limit: int = 64) -> str:
        if type(limit) is not int or not 1 <= limit <= 256:
            raise ValueError("Generation limit must be 1..256")
        # Check the cheap character bound before allocating UTF-8/token copies.
        if not isinstance(prompt, str) or len(prompt) > 511:
            raise ValueError("Prototype prompt too long or not a string")
        tokens = encode(prompt)[:-1]
        if len(tokens) + limit > 512:
            raise ValueError("Prototype prompt plus generation exceeds 512-token session")
        device = self.embedding.weight.device
        logits, state = self(torch.tensor([tokens], dtype=torch.long, device=device))
        generated = []
        for _ in range(limit):
            token = int(logits[0, -1].argmax())
            if token == EOS:
                break
            generated.append(token)
            logits, state = self(torch.tensor([[token]], dtype=torch.long, device=device), state)
        return decode(generated)


def export_checkpoint(model: NoriModel, path: Path, provenance: dict):
    """Own data-only format; no pickle, external checkpoint or executable code."""
    if provenance.get("origin") != "random_initialization" or provenance.get("assistant_qualified") is not False:
        raise ValueError("Prototype must declare random origin and unqualified status")
    parts, specs, offset = [], [], 0
    for name, tensor in model.state_dict().items():
        if not bool(torch.isfinite(tensor).all()):
            raise ValueError("Nonfinite weights")
        raw = tensor.detach().cpu().numpy().astype("<f4").tobytes()
        specs.append({"name": name, "shape": list(tensor.shape), "offset": offset, "bytes": len(raw)})
        parts.append(raw)
        offset += len(raw)
    payload = b"".join(parts)
    header = json.dumps({"format": "nori-dualtrace-v0", "config": asdict(model.config),
        "provenance": provenance, "sha256": sha256(payload).hexdigest(), "tensors": specs},
        sort_keys=True, allow_nan=False).encode("utf-8")
    if len(header) > MAX_HEADER or len(payload) + len(header) + 12 > MAX_CHECKPOINT:
        raise ValueError("Prototype checkpoint exceeds bounds")
    with path.open("xb") as handle:
        handle.write(MAGIC + struct.pack("<I", len(header)) + header + payload)


def load_checkpoint(path: Path):
    """Validate full bounded metadata/digest/shapes before loading tensor data."""
    with path.open("rb") as handle:
        raw = handle.read(MAX_CHECKPOINT + 1)
    return load_checkpoint_data(raw)


def load_checkpoint_data(raw: bytes):
    """Validate one immutable file snapshot, also used by the native exporter."""
    if not isinstance(raw, bytes):
        raise ValueError("Checkpoint snapshot must be immutable bytes")
    if len(raw) > MAX_CHECKPOINT or len(raw) < 12 or raw[:8] != MAGIC:
        raise ValueError("Invalid Nori checkpoint magic/size")
    length = struct.unpack("<I", raw[8:12])[0]
    if not 1 <= length <= MAX_HEADER or 12 + length >= len(raw):
        raise ValueError("Invalid metadata bounds")
    header = json.loads(raw[12:12 + length])
    payload = raw[12 + length:]
    if header.get("format") != "nori-dualtrace-v0" or sha256(payload).hexdigest() != header.get("sha256"):
        raise ValueError("Invalid checkpoint format/digest")
    provenance = header.get("provenance", {})
    if provenance.get("origin") != "random_initialization" or provenance.get("assistant_qualified") is not False:
        raise ValueError("Invalid prototype origin/qualification")
    model = NoriModel(Config(**header["config"]))
    expected = model.state_dict()
    specs = header.get("tensors")
    if not isinstance(specs, list) or len(specs) != len(expected):
        raise ValueError("Incomplete tensor table")
    offset, tensors = 0, {}
    for spec in specs:
        name = spec.get("name")
        if name not in expected or name in tensors or spec.get("shape") != list(expected[name].shape):
            raise ValueError("Unknown/duplicate tensor or shape mismatch")
        size = expected[name].numel() * 4
        if spec.get("offset") != offset or spec.get("bytes") != size or offset + size > len(payload):
            raise ValueError("Invalid tensor offset/length")
        value = np.frombuffer(payload, dtype="<f4", count=size // 4, offset=offset).copy()
        if not np.isfinite(value).all():
            raise ValueError("Nonfinite checkpoint weights")
        tensors[name] = torch.from_numpy(value.reshape(expected[name].shape))
        offset += size
    if offset != len(payload):
        raise ValueError("Trailing checkpoint bytes")
    model.load_state_dict(tensors, strict=True)
    model.eval()
    return model, provenance
