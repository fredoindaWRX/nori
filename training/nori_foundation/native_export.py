"""Data-only bridge from our training checkpoint to our native graph reader."""
import argparse
from hashlib import sha256
from pathlib import Path
import struct
from .model import MAX_CHECKPOINT, load_checkpoint_data

MAGIC = b"NDT0F32\0"
ROOT = Path(__file__).resolve().parents[2]


def ordered_names(layers):
    names = ["embedding.weight"]
    for layer in range(layers):
        names.extend(f"traces.{layer}.{name}" for name in (
            "proposal.weight", "proposal.bias", "gate.weight", "gate.bias", "decay",
            "mix.weight", "mix.bias", "norm.weight", "norm.bias"))
    return names + ["output.weight", "output.bias"]


def export_native(source: Path, destination: Path):
    # Hash the exact bounded snapshot that produced the tensors. Re-reading a
    # changing source after validation could otherwise bind the wrong revision.
    with source.open("rb") as handle:
        source_bytes = handle.read(MAX_CHECKPOINT + 1)
    model, _ = load_checkpoint_data(source_bytes)
    state = model.state_dict()
    names = ordered_names(model.config.layers)
    if set(names) != set(state):
        raise ValueError("Native graph tensor contract mismatch")
    payload = b"".join(state[name].numpy().astype("<f4").tobytes() for name in names)
    header = MAGIC + struct.pack("<6I", 1, model.config.width, model.config.layers,
                                 len(payload) // 4, 1, 0)
    # Random origin, NOT assistant-qualified. Digests bind source and tensor bytes.
    header += sha256(source_bytes).digest() + sha256(payload).digest()
    assert len(header) == 96
    with destination.open("xb") as handle:
        handle.write(header + payload)
    return sha256(header + payload).hexdigest()


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("checkpoint", type=Path)
    args = parser.parse_args()
    source = args.checkpoint.resolve(strict=True)
    if not source.is_relative_to((ROOT / "models" / "nori-development").resolve()):
        raise ValueError("CLI export only accepts Nori development checkpoints")
    target = source.with_suffix(".ndt")
    print(f"{target} SHA256={export_native(source, target)}")
