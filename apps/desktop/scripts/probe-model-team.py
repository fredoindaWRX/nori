"""Owned, authenticated loopback probes using Nori's existing engine binary."""
import hashlib
import json
import math
import os
from pathlib import Path
import secrets
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.request

ENGINE = Path(r'C:\Program Files\Nori\resources\NoriSuite\engine\gpt-oss-runtime\build\bin\llama-server.exe')
ROOT = Path(r'C:\Nori')
ROLE = sys.argv[1] if len(sys.argv) == 2 else 'embedding'
PROFILES = {
    'embedding': ('embedding/qwen3-embedding-0.6b-370f27d7', 18789, 4096),
    'everyday': ('language/qwen3.5-9b-unsloth-3885219b', 18790, 65536),
}
if ROLE not in PROFILES:
    raise ValueError('Unknown probe role')
folder, port, context = PROFILES[ROLE]
directory = ROOT / 'models' / folder
provenance = json.loads((directory / 'nori-model-provenance.json').read_text())
model = directory / provenance['file']
digest = hashlib.sha256()
with model.open('rb') as source:
    for chunk in iter(lambda: source.read(4 * 1024 * 1024), b''):
        digest.update(chunk)
if digest.hexdigest() != provenance['sha256'] or model.stat().st_size != provenance['size']:
    raise ValueError('Model identity changed')
with socket.socket() as check:
    check.bind(('127.0.0.1', port))
key = secrets.token_hex(32)
environment = dict(os.environ, LLAMA_API_KEY=key, OMP_NUM_THREADS='4')
arguments = [str(ENGINE), '--model', str(model), '--host', '127.0.0.1', '--port', str(port),
             '--alias', f'nori-{ROLE}-probe', '--ctx-size', str(context), '--parallel', '1',
             '--n-gpu-layers', '0', '--threads', '4', '--batch-size', '128', '--ubatch-size', '64']
if ROLE == 'embedding':
    arguments += ['--embedding', '--pooling', 'last']
else:
    arguments += ['--jinja', '--no-kv-offload']
log_path = ROOT / '.work' / 'reports' / f'model-team-{ROLE}-engine.log'
result_path = ROOT / '.work' / 'reports' / f'model-team-{ROLE}-probe.json'
if log_path.exists() or result_path.exists():
    raise ValueError('Existing probe evidence preserved')

def request(route, payload=None, timeout=30):
    body = json.dumps(payload).encode() if payload is not None else None
    req = urllib.request.Request(f'http://127.0.0.1:{port}{route}', data=body,
        headers={'Authorization': 'Bearer ' + key, 'Content-Type': 'application/json'})
    with urllib.request.urlopen(req, timeout=timeout) as response:
        return json.load(response)

report = {'role': ROLE, 'model': str(model), 'modelSha256': provenance['sha256'],
          'engine': str(ENGINE), 'backend': 'CPU-only acceptance probe',
          'configuredContextTokens': context, 'fullContextCapacityQualified': False,
          'productionSelectionChanged': False, 'passed': False}
started = time.monotonic()
with log_path.open('xb') as log:
    child = subprocess.Popen(arguments, env=environment, stdout=subprocess.DEVNULL,
        stderr=log, creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
    try:
        ready = False
        deadline = time.monotonic() + 180
        while time.monotonic() < deadline:
            if child.poll() is not None:
                raise RuntimeError(f'Owned engine exited before readiness: {child.returncode}')
            try:
                ready = request('/health', timeout=2).get('status') == 'ok'
            except (OSError, urllib.error.URLError):
                pass
            if ready:
                break
            time.sleep(1)
        if not ready:
            raise RuntimeError('Owned engine readiness deadline exceeded')
        report['readySeconds'] = round(time.monotonic() - started, 2)
        if ROLE == 'embedding':
            texts = ['Find a blue rally car with gold wheels.',
                     'A blue Subaru rally car has gold wheels and neon reflections.',
                     'A recipe for baking chocolate cookies in an oven.']
            response = request('/v1/embeddings', {'input': texts, 'model': 'nori-embedding-probe'}, timeout=60)
            vectors = [entry['embedding'] for entry in sorted(response['data'], key=lambda item: item['index'])]
            if len(vectors) != 3 or any(len(v) != 1024 or not all(math.isfinite(x) for x in v) for v in vectors):
                raise RuntimeError('Invalid embedding output')
            def cosine(a, b):
                return sum(x*y for x,y in zip(a,b)) / math.sqrt(sum(x*x for x in a)*sum(y*y for y in b))
            relevant, unrelated = cosine(vectors[0], vectors[1]), cosine(vectors[0], vectors[2])
            if relevant <= unrelated:
                raise RuntimeError('Synthetic retrieval relevance check failed')
            report.update(dimensions=1024, relevantSimilarity=relevant, unrelatedSimilarity=unrelated)
        else:
            response = request('/v1/chat/completions', {
                'model': 'nori-everyday-probe', 'messages': [{'role':'user','content':'What is 17 plus 25? Reply with the number only.'}],
                'max_tokens': 32, 'temperature': 0, 'chat_template_kwargs': {'enable_thinking': False}}, timeout=180)
            text = response['choices'][0]['message'].get('content', '').strip()
            if text != '42':
                raise RuntimeError('Short answer check failed: ' + text[:100])
            report.update(reply=text, usage=response.get('usage'), timings=response.get('timings'))
        report['passed'] = True
    except Exception as error:
        report['error'] = str(error).replace(key, '[redacted]')
    finally:
        if child.poll() is None:
            child.terminate()
            try:
                child.wait(timeout=10)
            except subprocess.TimeoutExpired:
                child.kill()
                child.wait(timeout=10)
        report['ownedProbeProcessStopped'] = child.poll() is not None
        report['elapsedSeconds'] = round(time.monotonic() - started, 2)
result_path.write_text(json.dumps(report, indent=2), encoding='utf-8')
print(json.dumps(report), flush=True)
raise SystemExit(0 if report['passed'] else 1)
