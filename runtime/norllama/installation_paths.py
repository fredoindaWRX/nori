"""Resolve installed runtime resources without using extraction or working dirs."""
from pathlib import Path
import sys


def runtime_installation(source_file, *, frozen=None, executable=None):
    """Frozen builds must live in the same runtime/norllama suite slot.

    No current executable build is implied. A freezer's temporary __file__ or
    _MEIPASS directory must never become the active model/configuration root.
    """
    if frozen is None:
        frozen = bool(getattr(sys, "frozen", False))
    anchor = executable if frozen else source_file
    if frozen and executable is None:
        anchor = sys.executable
    if not anchor:
        raise ValueError("Missing runtime installation anchor")
    location = Path(anchor)
    if not location.is_absolute():
        raise ValueError("Runtime installation anchor must be absolute")
    directory = location.resolve().parent
    if directory.name.lower() != "norllama" or directory.parent.name.lower() != "runtime":
        raise ValueError("Runtime must be installed in Nori/runtime/norllama")
    return directory.parent.parent, directory / "config.json"
