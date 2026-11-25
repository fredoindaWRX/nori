"""Owned, offline Parakeet worker; same bounded line protocol as Whisper.

NVIDIA parakeet-tdt-0.6b-v3 weights: CC BY 4.0.
https://huggingface.co/nvidia/parakeet-tdt-0.6b-v3
This worker never opens a microphone, downloads files, or deletes caller audio.
"""
import hashlib
import json
import os
from pathlib import Path
import sys

MODEL = Path(r'C:\Nori\models\speech\parakeet-tdt-0.6b-v3-541d1f99')
PACKAGES = Path(r'C:\Nori\runtime\parakeet-packages')
PINS = {
 'model.safetensors': '3a2026366188c8c68598edbbff92f8d11590a08e0ae2e6775544e7b07d6a5e11',
 'config.json': 'e747b85e1bdfd300c8b8ac63bac8dd5221f8fe9bc275b48d06c735fcd6971b6e',
 'generation_config.json': 'b141de6ec6d7f982ece13f98f604e3fe1807ea9c0e839185d0ab7064604209d0',
 'processor_config.json': '8346a93a3b987fa1dec57a78f045cd0817d21786589a5a096b41a57a446fd1d7',
 'tokenizer.json': 'bd321b096832a3f270bd3b2a88823957920f1a5c5ada71114a26ea729d0cbe91',
 'tokenizer_config.json': '0b2fe0037599ee335f0b972fa682bf0ece74e4ccfec755cb7daa3405d3d3e874',
}

def physical(path):
    for item in (path, *path.parents):
        info = item.lstat()
        if item.is_symlink() or getattr(info, 'st_file_attributes', 0) & 0x400:
            raise ValueError('Linked speech model or dependency path refused')
    if os.path.normcase(str(path.resolve())) != os.path.normcase(str(path.absolute())):
        raise ValueError('Speech path resolves elsewhere')

def verify_model():
    physical(PACKAGES)
    for name, expected in PINS.items():
        path = MODEL / name
        physical(path)
        if path.stat().st_nlink != 1:
            raise ValueError('Linked speech model file refused')
        digest = hashlib.sha256()
        with path.open('rb') as source:
            for chunk in iter(lambda: source.read(4 * 1024 * 1024), b''):
                digest.update(chunk)
        if digest.hexdigest() != expected:
            raise ValueError('Pinned speech model data changed')

def decode_audio(path):
    import av
    import numpy as np
    chunks = []
    samples = 0
    with av.open(path) as container:
        resampler = av.AudioResampler(format='fltp', layout='mono', rate=16000)
        for frame in container.decode(audio=0):
            for decoded in resampler.resample(frame):
                samples += decoded.samples
                if samples > 120 * 16000:
                    raise ValueError('Speech clip exceeds two minutes')
                chunks.append(decoded.to_ndarray().reshape(-1))
        for decoded in resampler.resample(None):
            samples += decoded.samples
            if samples > 120 * 16000:
                raise ValueError('Speech clip exceeds two minutes')
            chunks.append(decoded.to_ndarray().reshape(-1))
    return np.concatenate(chunks) if chunks else np.empty(0, dtype=np.float32)

def emit(value):
    print(json.dumps(value), flush=True)

def main():
    try:
        verify_model()
        os.environ.update(HF_HUB_OFFLINE='1', TRANSFORMERS_OFFLINE='1', HF_HUB_DISABLE_TELEMETRY='1',
            NUMBA_CACHE_DIR=r'C:\Nori\runtime\parakeet-cache')
        sys.path.insert(0, str(PACKAGES))
        import torch
        from transformers import AutoModelForTDT, AutoProcessor
        torch.set_num_threads(2)
        processor = AutoProcessor.from_pretrained(str(MODEL), local_files_only=True, trust_remote_code=False)
        model = AutoModelForTDT.from_pretrained(str(MODEL), local_files_only=True, trust_remote_code=False,
            dtype=torch.float32, attn_implementation='eager').eval()
    except Exception:
        emit({'error': 'Pinned local Parakeet could not start'})
        return 1
    emit({'ready': True, 'model': 'parakeet-tdt-0.6b-v3', 'backend': 'cpu'})
    for line in sys.stdin:
        path = line.strip()
        if not path:
            continue
        try:
            audio = decode_audio(path)
            if not audio.size or not audio.any():
                text = ''
            else:
                inputs = processor(audio, sampling_rate=16000, return_tensors='pt')
                with torch.inference_mode():
                    output = model.generate(**inputs, return_dict_in_generate=True, max_new_tokens=1024)
                decoded = processor.decode(output.sequences, skip_special_tokens=True)
                text = ' '.join(decoded) if isinstance(decoded, list) else str(decoded)
            emit({'text': text.strip()})
        except Exception:
            emit({'error': 'Local speech transcription failed'})
    return 0

if __name__ == '__main__':
    raise SystemExit(main())
