"""Pinned public model downloads; no downloaded code is executed."""
import concurrent.futures
import hashlib
import json
from pathlib import Path
import time
import urllib.request

ROOT = Path(r'C:\Nori\models')
MODELS = [
    dict(repo='unsloth/Qwen3.5-9B-GGUF', revision='3885219b6810b007914f3a7950a8d1b469d598a5',
         file='Qwen3.5-9B-Q4_K_M.gguf', size=5680522464,
         sha256='03b74727a860a56338e042c4420bb3f04b2fec5734175f4cb9fa853daf52b7e8',
         folder='language/qwen3.5-9b-unsloth-3885219b', license='apache-2.0'),
    dict(repo='Qwen/Qwen3-Embedding-0.6B-GGUF', revision='370f27d7550e0def9b39c1f16d3fbaa13aa67728',
         file='Qwen3-Embedding-0.6B-Q8_0.gguf', size=639150592,
         sha256='06507c7b42688469c4e7298b0a1e16deff06caf291cf0a5b278c308249c3e439',
         folder='embedding/qwen3-embedding-0.6b-370f27d7', license='apache-2.0'),
]

def digest(path):
    value = hashlib.sha256()
    with path.open('rb') as stream:
        for chunk in iter(lambda: stream.read(4 * 1024 * 1024), b''):
            value.update(chunk)
    return value.hexdigest()

def physical(path):
    if not path.resolve().is_relative_to(ROOT.resolve()):
        raise ValueError('Model destination escaped its store')
    for part in (path, *path.parents):
        if part.exists() and (part.is_symlink() or getattr(part.lstat(), 'st_file_attributes', 0) & 0x400):
            raise ValueError('Linked model destination refused')

def download(model):
    destination = ROOT / model['folder'] / model['file']
    physical(destination)
    destination.parent.mkdir(parents=True, exist_ok=True)
    if destination.exists():
        if destination.stat().st_size != model['size'] or digest(destination) != model['sha256']:
            raise ValueError('Existing model differs; preserved without replacement')
    else:
        partial = destination.with_suffix(destination.suffix + '.part')
        physical(partial)
        offset = partial.stat().st_size if partial.exists() else 0
        if offset > model['size']:
            raise ValueError('Oversized partial preserved')
        url = f"https://huggingface.co/{model['repo']}/resolve/{model['revision']}/{model['file']}"
        if offset < model['size']:
            request = urllib.request.Request(url, headers={'User-Agent': 'Nori-Pinned-Model-Installer/1', **({'Range': f'bytes={offset}-'} if offset else {})})
            with urllib.request.urlopen(request, timeout=60) as response:
                if response.status == 206:
                    if not response.headers.get('Content-Range', '').startswith(f'bytes {offset}-'):
                        raise ValueError('Unexpected resumed range')
                elif response.status == 200:
                    offset = 0
                else:
                    raise ValueError('Unexpected model download response')
                last = 0
                with partial.open('ab' if offset else 'wb') as target:
                    while chunk := response.read(4 * 1024 * 1024):
                        offset += len(chunk)
                        if offset > model['size']:
                            raise ValueError('Model download exceeded pinned size')
                        target.write(chunk)
                        if time.monotonic() - last > 20:
                            print(json.dumps({'file': model['file'], 'bytes': offset, 'total': model['size'], 'percent': round(offset / model['size'] * 100, 1)}), flush=True)
                            last = time.monotonic()
        if partial.stat().st_size != model['size'] or digest(partial) != model['sha256']:
            raise ValueError('Pinned model verification failed; partial preserved')
        partial.rename(destination)
    receipt = {**model, 'path': str(destination), 'verified': True, 'downloadedCodeExecuted': False}
    metadata = destination.parent / 'nori-model-provenance.json'
    if metadata.exists():
        if json.loads(metadata.read_text(encoding='utf-8')) != receipt:
            raise ValueError('Existing provenance differs; preserved')
    else:
        metadata.write_text(json.dumps(receipt, indent=2), encoding='utf-8')
    print(json.dumps({'verified': True, 'file': model['file'], 'path': str(destination)}), flush=True)
    return receipt

if __name__ == '__main__':
    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as workers:
        results = list(workers.map(download, MODELS))
    print(json.dumps({'verifiedModels': len(results), 'totalBytes': sum(m['size'] for m in results)}), flush=True)
