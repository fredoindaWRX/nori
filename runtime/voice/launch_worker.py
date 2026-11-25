"""Root-relative isolated launcher for recovered local speech; no cloud fallback.

This is Nori's adapter, NOT a claim that Kokoro/ONNX/Python are Nori-created.
The imported model/dependency names and their licenses remain intact.
"""
import hashlib
import json
from pathlib import Path
import runpy
import sys

ROOT = Path(__file__).resolve().parents[2]
PACKAGES = ROOT / 'runtime/voice/packages'
EXPECTED = {'kokoro-v1.0.onnx': 'beb0d1848dee9a49da392cc3df26958d46cfa35d321edf434f52949153f0df3a',
            'voices-v1.0.bin': 'bca610b8308e8d99f32e6fe4197e7ec01679264efed0cac9140fe9c29f1fbf7d'}


def contained(path):
    return path.resolve().is_relative_to(ROOT)


def validate_invocation(argv):
    if len(argv) < 2 or argv[1] not in ('--kokoro', '--diagnose'):
        raise ValueError('Only --kokoro or --diagnose is supported')
    if (argv[1] == '--diagnose' and len(argv) != 2) or (argv[1] == '--kokoro' and len(argv) != 5):
        raise ValueError('Kokoro requires worker/model/voices; diagnose takes no arguments')
    if argv[1] == '--diagnose': return None
    worker, model, voices = map(Path, argv[2:])
    if not contained(worker) or worker.resolve() != (ROOT / 'apps/desktop/bridge/kokoro_tts.py').resolve():
        raise ValueError('Only the canonical Nori Kokoro bridge worker is allowed')
    if not contained(model) or not contained(voices): raise ValueError('Voice weight path escapes Nori')
    if model.name != 'kokoro-v1.0.onnx' or voices.name != 'voices-v1.0.bin':
        raise ValueError('Model and voices must not be swapped or renamed')
    return worker, model, voices


def main():
    invocation = validate_invocation(sys.argv)
    if not sys.flags.isolated or not sys.dont_write_bytecode:
        raise ValueError('Voice launcher requires isolated Python and disabled bytecode')
    if not contained(Path(sys.executable)) or not contained(Path(sys.prefix)) or not contained(PACKAGES):
        raise ValueError('Speech interpreter/packages are outside the Nori root')
    if not PACKAGES.is_dir(): raise ValueError('Consolidated voice packages are missing')
    sys.path.insert(0, str(PACKAGES))
    import numpy
    import onnxruntime
    import kokoro_onnx
    onnxruntime.disable_telemetry_events()
    for module in (numpy, onnxruntime, kokoro_onnx):
        if not Path(module.__file__).resolve().is_relative_to(PACKAGES):
            raise ValueError('Speech dependency came from a foreign package root')
    if sys.argv[1] == '--diagnose':
        print(json.dumps({'executable': sys.executable, 'prefix': sys.prefix,
                          'packages': str(PACKAGES), 'isolated': True, 'bytecode_disabled': True,
                          'numpy': numpy.__version__, 'onnxruntime': onnxruntime.__version__,
                          'kokoro_onnx': str(Path(kokoro_onnx.__file__).relative_to(ROOT)),
                          'network_model_download': False}))
        return
    worker, model, voices = invocation
    for path in (model, voices):
        expected = EXPECTED.get(path.name)
        if expected is None: raise ValueError('Unsupported voice weight filename')
        if not contained(path): raise ValueError('Voice weight path escapes Nori')
        sha = hashlib.sha256()
        with path.open('rb') as source:
            for block in iter(lambda: source.read(1024 * 1024), b''): sha.update(block)
        if sha.hexdigest() != expected: raise ValueError('Kokoro weight checksum changed')
    if not contained(worker): raise ValueError('Voice worker escapes Nori')
    sys.argv = [str(worker), str(model), str(voices)]
    runpy.run_path(str(worker), run_name='__main__')


if __name__ == '__main__': main()
