"""Shared tools for NORI's in-process agents.

The desktop runtime historically exposed its tool registry from the
top-level ``C:\\Nori\\tools.py`` module.  During the package migration,
``nori.tools`` became the import that wins on the runtime path, but its
empty ``__init__`` dropped the public ``TOOLS`` mapping.  Long-running
workers (active learning, the legacy voice bridge, and a few recovery
jobs) still depend on that contract. Resolve it only when a legacy API is
requested. Missing legacy source must not prevent importing independent package
utilities, and must never silently produce an empty or permissive tool registry.
"""

from importlib.util import module_from_spec, spec_from_file_location
from pathlib import Path


def _load_legacy_registry():
    legacy_path = Path(__file__).resolve().parents[2] / "tools.py"
    if not legacy_path.is_file():
        raise ImportError('Nori legacy tool registry is unavailable: tools.py has not been recovered. '
                          'Use authenticated Core task tools; no legacy tool execution is available.')
    spec = spec_from_file_location("_nori_legacy_tools", legacy_path)
    if spec is None or spec.loader is None:
        raise ImportError(f"Unable to load NORI tool registry: {legacy_path}")
    module = module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


_legacy_tools = None

# The legacy module also exposes policy/configuration constants and helper
# callables that older workers patch or import directly (for example
# ``ALLOWED_TEXT_ROOTS`` in the file writer).  Re-export its public names so
# the package migration does not silently narrow the runtime API.
def _registry():
    global _legacy_tools
    if _legacy_tools is None:
        legacy = _load_legacy_registry()
        if not isinstance(getattr(legacy, 'TOOLS', None), dict):
            raise ImportError('Nori legacy tool registry has an invalid TOOLS contract')
        _legacy_tools = legacy
        for name, value in vars(legacy).items():
            if not name.startswith('_'):
                globals().setdefault(name, value)
        # Capture must continue through the package's lease-aware adapters.
        legacy.TOOLS['capture_camera'] = capture_camera
        legacy.TOOLS['capture_screen'] = capture_screen
    return _legacy_tools


def __getattr__(name):
    if name.startswith('_'):
        raise AttributeError(name)
    legacy = _registry()
    try: return getattr(legacy, name)
    except AttributeError: raise AttributeError(name) from None


def create_text_file(path, content=""):
    """Package-facing adapter that honors patched package policy constants."""
    legacy = _registry()
    legacy.ALLOWED_TEXT_ROOTS = globals().get('ALLOWED_TEXT_ROOTS', legacy.ALLOWED_TEXT_ROOTS)
    legacy.log_action = globals().get('log_action', legacy.log_action)
    return legacy.create_text_file(path, content)


def capture_camera(camera_index=0):
    """Capture through a short-lived owner lease (package compatibility)."""
    legacy = _registry()
    legacy.DeviceControlLeases = globals().get('DeviceControlLeases', legacy.DeviceControlLeases)
    legacy.leased_camera_capture = globals().get('leased_camera_capture', legacy.leased_camera_capture)
    return legacy.capture_camera(camera_index)


def capture_screen():
    """Capture the display through a short-lived owner lease."""
    legacy = _registry()
    legacy.DeviceControlLeases = globals().get('DeviceControlLeases', legacy.DeviceControlLeases)
    legacy.leased_display_capture = globals().get('leased_display_capture', legacy.leased_display_capture)
    legacy.read_perception_snapshot = globals().get('read_perception_snapshot', legacy.read_perception_snapshot)
    return legacy.capture_screen()


# Keep model dispatch pointed at the package adapters rather than the legacy
# function objects whose globals cannot see test/runtime dependency patches.
# Bound lazily above; no registry or capture permission is created at import.

__all__ = ["TOOLS"]
