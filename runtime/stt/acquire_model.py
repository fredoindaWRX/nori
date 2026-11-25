"""Explicit pinned public model acquisition; runtime itself stays offline."""
import hashlib
import json
from pathlib import Path
import sys
import urllib.request

ROOT = Path(__file__).resolve().parents[2]
TARGET = ROOT / 'models/voice/whisper-base.en'
REPO = 'Systran/faster-whisper-base.en'
REVISION = '3d3d5dee26484f91867d81cb899cfcf72b96be6c'


def main():
    if sys.argv[1:] != ['--download']:
        raise ValueError('Explicit --download required')
    if TARGET.exists():
        raise ValueError('Refusing to overwrite an existing model directory')
    url = f'https://huggingface.co/api/models/{REPO}/revision/{REVISION}?blobs=true'
    with urllib.request.urlopen(url, timeout=30) as response:
        metadata = json.load(response)
    if metadata['sha'] != REVISION:
        raise ValueError('Publisher revision mismatch')
    wanted = ['config.json', 'model.bin', 'tokenizer.json', 'vocabulary.txt', 'README.md']
    records = {item['rfilename']: item for item in metadata['siblings']}
    for name in wanted:
        if name not in records or not 0 < records[name]['size'] < 200_000_000:
            raise ValueError('Publisher payload size missing or outside bound')
    TARGET.mkdir()
    receipts = []
    for name in wanted:
        record = records[name]
        partial = TARGET / (name + '.partial')
        sha = hashlib.sha256()
        git = hashlib.sha1(f"blob {record['size']}\0".encode())
        count = 0
        with urllib.request.urlopen(f'https://huggingface.co/{REPO}/resolve/{REVISION}/{name}', timeout=30) as response, partial.open('xb') as output:
            while block := response.read(1024 * 1024):
                count += len(block)
                if count > record['size']:
                    raise ValueError('Download exceeded publisher size')
                output.write(block)
                sha.update(block)
                git.update(block)
        expected = record.get('lfs', {}).get('sha256')
        if count != record['size'] or (sha.hexdigest() != expected if expected else git.hexdigest() != record['blobId']):
            raise ValueError('Publisher content hash mismatch')
        partial.replace(TARGET / name)
        receipts.append({'file': name, 'bytes': count, 'sha256': sha.hexdigest()})
    receipt = {'repository': REPO, 'revision': REVISION, 'publisherLicense': 'MIT',
               'importedModel': True, 'runtimeOffline': True, 'files': receipts,
               'transcriptionVerified': False}
    (TARGET / 'provenance.json').write_text(json.dumps(receipt, indent=2) + '\n', encoding='utf-8')
    print(json.dumps(receipt))


if __name__ == '__main__':
    main()
