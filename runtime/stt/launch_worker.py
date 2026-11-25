"""Nori-root speech-recognition launcher; offline model loading only."""
import os
import hashlib
from pathlib import Path
import runpy
import sys

ROOT = Path(__file__).resolve().parents[2]
PACKAGES = ROOT / 'runtime/stt/packages'
MODEL = ROOT / 'models/voice/whisper-base.en'
WORKER = ROOT / 'apps/desktop/bridge/whisper_stt.py'
REQUIRED = ('config.json', 'model.bin', 'tokenizer.json', 'vocabulary.txt')
EXPECTED = {
    'config.json': 'f3bc3821e9fc76a27bae538e11ae5b677dcdd352b4600429ce7951d398569aeb',
    'model.bin': '2a166925539a16005f14ff328359f9b9adb9dc4fb631bb3b227526862e93e2ef',
    'tokenizer.json': '929c5252409436dce1b38a75d1abbcb5e132d170d8e324e4e04ed915fa2d22df',
    'vocabulary.txt': 'ff77588746d3a2595d32ab5b69ffd7b95ce2441ac57533cb66fc3eb575a115cf',
}


def validate_payload():
    for path in (PACKAGES, MODEL, WORKER):
        if not path.resolve().is_relative_to(ROOT):
            raise ValueError('STT component escapes Nori root')
    if not PACKAGES.is_dir() or not WORKER.is_file():
        raise ValueError('STT packages or worker are missing')
    for name in REQUIRED:
        path = MODEL / name
        if not path.resolve().is_relative_to(MODEL.resolve()) or not path.is_file() or path.stat().st_size == 0:
            raise ValueError('Complete local Whisper model is required; no download attempted')
        digest = hashlib.sha256()
        with path.open('rb') as source:
            for block in iter(lambda: source.read(1024 * 1024), b''):
                digest.update(block)
        if digest.hexdigest() != EXPECTED[name]:
            raise ValueError('Whisper model content hash mismatch; no fallback attempted')


def main():
    if len(sys.argv) != 1 or not sys.flags.isolated or not sys.dont_write_bytecode:
        raise ValueError('STT launcher requires isolated Python, disabled bytecode, and no extra arguments')
    if not Path(sys.executable).resolve().is_relative_to(ROOT):
        raise ValueError('STT interpreter must be inside Nori')
    validate_payload()
    sys.path.insert(0, str(PACKAGES))
    os.environ.update(NORI_WHISPER_MODEL=str(MODEL), HF_HUB_OFFLINE='1', TRANSFORMERS_OFFLINE='1')
    sys.argv = [str(WORKER)]
    runpy.run_path(str(WORKER), run_name='__main__')


if __name__ == '__main__':
    main()
