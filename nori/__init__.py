"""Nori local runtime support packages.

Imports are intentionally lazy so ``python -m nori.diagnostics`` executes the
module exactly once and does not emit runpy's pre-import warning.
"""


def collect_diagnostics(*args, **kwargs):
    from .diagnostics import collect
    return collect(*args, **kwargs)


def roadmap_evidence(*args, **kwargs):
    from .roadmap_status import report
    return report(*args, **kwargs)


def load_checkpoint(*args, **kwargs):
    from .recovery import load_checkpoint as _load
    return _load(*args, **kwargs)


def save_checkpoint(*args, **kwargs):
    from .recovery import save_checkpoint as _save
    return _save(*args, **kwargs)


__all__ = ["collect_diagnostics", "roadmap_evidence", "load_checkpoint", "save_checkpoint"]
