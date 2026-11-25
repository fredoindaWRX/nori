"""Isolated root-contained launch for Nori hand input; diagnose never controls."""
import json
from pathlib import Path
import runpy
import sys
import os

ROOT = Path(__file__).resolve().parents[2]
PACKAGES = ROOT / 'runtime/stt/packages'
WORKER = ROOT / 'apps/desktop/bridge/system_hand_input.py'

def main():
    if sys.argv[1:] not in ([], ['--diagnose']) or not sys.flags.isolated or not sys.dont_write_bytecode:
        raise ValueError('Input launcher requires isolated Python and optional --diagnose only')
    for path in (Path(sys.executable), PACKAGES, WORKER):
        if not path.resolve().is_relative_to(ROOT):
            raise ValueError('Input component escapes Nori')
    if not PACKAGES.is_dir() or not WORKER.is_file():
        raise ValueError('Input runtime is incomplete')
    sys.path.insert(0, str(PACKAGES))
    if os.name == 'nt' and sys.argv[1:] != ['--diagnose']:
        # Physical virtual-desktop coordinates must not be DPI-virtualized.
        import ctypes
        ctypes.windll.user32.SetProcessDpiAwarenessContext(ctypes.c_void_p(-4))
    import pyautogui
    if not Path(pyautogui.__file__).resolve().is_relative_to(PACKAGES.resolve()):
        raise ValueError('Input dependency loaded outside Nori packages')
    if sys.argv[1:] == ['--diagnose']:
        print(json.dumps({'importsPassed': True, 'python': sys.executable,
                          'packages': str(PACKAGES), 'mouseActions': 0, 'serverStarted': False}))
        return
    sys.argv = [str(WORKER)]
    runpy.run_path(str(WORKER), run_name='__main__')

if __name__ == '__main__':
    main()
