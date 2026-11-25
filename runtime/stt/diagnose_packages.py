"""Offline isolated import check; no model load, microphone, or downloads."""
import importlib
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[2]
PACKAGES = ROOT / 'runtime/stt/packages'


def main():
    if not sys.flags.isolated or not sys.dont_write_bytecode:
        raise ValueError('STT diagnosis requires isolated Python with bytecode disabled')
    if not Path(sys.executable).resolve().is_relative_to(ROOT):
        raise ValueError('STT interpreter must be inside Nori')
    if not PACKAGES.resolve().is_relative_to(ROOT) or not PACKAGES.is_dir():
        raise ValueError('STT packages are missing or outside Nori')
    sys.path.insert(0, str(PACKAGES))
    versions = {}
    for name in ('numpy', 'av', 'ctranslate2', 'tokenizers', 'faster_whisper'):
        module = importlib.import_module(name)
        if not Path(module.__file__).resolve().is_relative_to(PACKAGES.resolve()):
            raise ValueError('STT dependency came from another package location')
        versions[name] = getattr(module, '__version__', 'unspecified')
    print(json.dumps({'importsPassed': True, 'python': sys.executable,
                      'packages': str(PACKAGES), 'versions': versions,
                      'modelLoaded': False, 'microphoneUsed': False}))


if __name__ == '__main__':
    main()
