"""Stable NORI-owned import surface for the Merovingian memory service."""

from importlib.util import module_from_spec, spec_from_file_location
from pathlib import Path

_path = Path(__file__).with_name("memory") / "nori_memory.py"
_spec = spec_from_file_location("_nori_memory_impl", _path)
if _spec is None or _spec.loader is None:
    raise ImportError("NORI memory implementation is unavailable")
_module = module_from_spec(_spec)
_spec.loader.exec_module(_module)
MemoryStore = _module.MemoryStore
