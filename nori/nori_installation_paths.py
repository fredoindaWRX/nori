"""Core resource locations for source and planned suite executable layouts."""
from pathlib import Path
import sys


def core_installation_root(source_root, *, frozen=None, executable=None):
    if frozen is None:
        frozen = bool(getattr(sys, "frozen", False))
    anchor = Path((executable or sys.executable) if frozen else source_root)
    if not anchor.is_absolute():
        raise ValueError("Core installation anchor must be absolute")
    location = anchor.resolve()
    if not frozen:
        return location
    directory = location.parent
    if directory.name.lower() == "nori":
        return directory
    # NorLlama also imports Core-owned contracts; those resources remain in
    # the suite's nori slot, not the freezer's temporary extraction directory.
    if directory.name.lower() == "norllama" and directory.parent.name.lower() == "runtime":
        return directory.parent.parent / "nori"
    raise ValueError("Core executable is outside the supported Nori suite layout")
