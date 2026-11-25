"""Stable NORI-specific import boundary for the local knowledge store.

The wider workspace already contains an unrelated ``knowledge.py`` module.
Loading the NORI implementation by its file path avoids importing that module
when the project is run from Windows or staged in an image.
"""

from importlib.util import module_from_spec, spec_from_file_location
from pathlib import Path
import sys


_source = Path(__file__).with_name("knowledge") / "nori_knowledge.py"
_spec = spec_from_file_location("_nori_knowledge_impl", _source)
if _spec is None or _spec.loader is None:
    raise ImportError("NORI knowledge implementation is unavailable")
_module = module_from_spec(_spec)
sys.modules[_spec.name] = _module
_spec.loader.exec_module(_module)

KnowledgeStore = _module.KnowledgeStore
