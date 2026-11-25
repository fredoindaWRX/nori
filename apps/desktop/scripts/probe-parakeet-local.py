"""Real CPU ASR probe using public documentation audio, never a microphone."""
import json
import os
import sys
from pathlib import Path
import time
import urllib.request
import wave

os.environ.update(HF_HUB_OFFLINE='1', TRANSFORMERS_OFFLINE='1', HF_HUB_DISABLE_TELEMETRY='1',
    NUMBA_CACHE_DIR=r'C:\Nori\runtime\parakeet-cache')
sys.path.insert(0, r'C:\Nori\runtime\parakeet-packages')
ROOT = Path(r'C:\Nori\models\speech\parakeet-tdt-0.6b-v3-541d1f99')
REPORT = Path(r'C:\Nori\.work\reports\parakeet-real-asr-probe.json')
SAMPLE = Path(r'C:\Nori\.work\reports\parakeet-public-test.wav')
SOURCE = 'https://dldata-public.s3.us-east-2.amazonaws.com/2086-149220-0033.wav'

def main():
    import numpy as np
    import torch
    from transformers import AutoModelForTDT, AutoProcessor
    torch.set_num_threads(2)
    if not SAMPLE.exists():
        with urllib.request.urlopen(SOURCE, timeout=30) as response:
            data = response.read(2 * 1024 * 1024 + 1)
        if len(data) > 2 * 1024 * 1024:
            raise ValueError('Public audio fixture exceeded bound')
        with SAMPLE.open('xb') as output:
            output.write(data)
    with wave.open(str(SAMPLE), 'rb') as recording:
        if recording.getnchannels() != 1 or recording.getframerate() != 16000 or recording.getsampwidth() != 2:
            raise ValueError('Unexpected public fixture format')
        audio = np.frombuffer(recording.readframes(recording.getnframes()), dtype='<i2').astype(np.float32) / 32768
    began = time.monotonic()
    processor = AutoProcessor.from_pretrained(str(ROOT), local_files_only=True, trust_remote_code=False)
    model = AutoModelForTDT.from_pretrained(str(ROOT), local_files_only=True, trust_remote_code=False,
        dtype=torch.float32, attn_implementation='eager').eval()
    ready = time.monotonic()
    inputs = processor(audio, sampling_rate=16000, return_tensors='pt')
    with torch.inference_mode():
        output = model.generate(**inputs, return_dict_in_generate=True)
    text = processor.decode(output.sequences, skip_special_tokens=True)
    result = {'model': 'nvidia/parakeet-tdt-0.6b-v3', 'backend': 'cpu', 'audioSource': SOURCE,
        'audioSeconds': len(audio)/16000, 'transcript': text, 'modelLoadSeconds': round(ready-began, 3),
        'transcriptionSeconds': round(time.monotonic()-ready, 3), 'microphoneUsed': False,
        'installedNoriConnectionVerified': False, 'referenceAccuracyBenchmarked': False}
    if not text or not any(str(t).strip() for t in (text if isinstance(text,list) else [text])):
        raise ValueError('ASR returned no speech')
    with REPORT.open('x', encoding='utf-8') as report:
        json.dump(result, report, indent=2)
    print(json.dumps(result), flush=True)

if __name__ == '__main__':
    main()
