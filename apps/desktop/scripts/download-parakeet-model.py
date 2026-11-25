"""Fetch pinned data and weights only; execute no downloaded Python code."""
import hashlib
import json
from pathlib import Path
import urllib.request
import importlib.util

spec = importlib.util.spec_from_file_location('nori_pinned_download', Path(__file__).with_name('download-model-team.py'))
downloader = importlib.util.module_from_spec(spec)
spec.loader.exec_module(downloader)
REPO = 'nvidia/parakeet-tdt-0.6b-v3'
REVISION = '541d1f99c6b0c3cd0b11a95167540bb8edefd82b'
FOLDER = 'speech/parakeet-tdt-0.6b-v3-541d1f99'
root = downloader.ROOT / FOLDER
downloader.physical(root)
root.mkdir(parents=True, exist_ok=True)
files = []
for name in ('config.json', 'generation_config.json', 'processor_config.json', 'tokenizer.json', 'tokenizer_config.json', 'README.md'):
    with urllib.request.urlopen(f'https://huggingface.co/{REPO}/resolve/{REVISION}/{name}', timeout=60) as response:
        data = response.read(2 * 1024 * 1024 + 1)
    if len(data) > 2 * 1024 * 1024:
        raise ValueError('Model metadata exceeded its bound')
    if name.endswith('.json'):
        parsed = json.loads(data)
        if 'auto_map' in parsed:
            raise ValueError('Remote model code refused')
    path = root / name
    downloader.physical(path)
    if path.exists():
        if path.read_bytes() != data:
            raise ValueError('Existing metadata differs and was preserved')
    else:
        with path.open('xb') as output:
            output.write(data)
    files.append({'file': name, 'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest()})

weight = downloader.download(dict(repo=REPO, revision=REVISION, folder=FOLDER,
    file='model.safetensors', size=2508311120,
    sha256='3a2026366188c8c68598edbbff92f8d11590a08e0ae2e6775544e7b07d6a5e11',
    license='cc-by-4.0'))
receipt = {'schema': 'nori.parakeet-model-data.v1', 'author': 'NVIDIA', 'source': f'https://huggingface.co/{REPO}',
    'license': 'cc-by-4.0', 'revision': REVISION, 'model': weight, 'metadata': files, 'downloadedCodeExecuted': False}
path = root / 'nori-parakeet-provenance.json'
if path.exists():
    if json.loads(path.read_text(encoding='utf-8')) != receipt:
        raise ValueError('Existing receipt differs and was preserved')
else:
    with path.open('x', encoding='utf-8') as output:
        json.dump(receipt, output, indent=2)
print(json.dumps({'verified': True, 'model': REPO, 'metadataFiles': len(files)}), flush=True)
