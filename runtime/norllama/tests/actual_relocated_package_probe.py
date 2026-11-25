"""Relocated own-model runtime acceptance; not a complete suite installer."""
from pathlib import Path
import argparse
from hashlib import sha256
import http.client
import json
import os
import queue
import secrets
import shutil
import subprocess
import tempfile
import threading

ROOT = Path(__file__).resolve().parents[3]


def main(receipt=None):
    parent = (ROOT / 'verification').resolve()
    if receipt is not None:
        receipt = receipt.resolve()
        if receipt.parent != parent or receipt.exists():
            raise ValueError('Receipt must be fresh and directly under verification')
    package = Path(tempfile.mkdtemp(prefix='.native-package-probe-', dir=parent)).resolve()
    if package.parent != parent:
        raise RuntimeError('Package fixture escaped verification')
    process = None
    try:
        shutil.copytree(ROOT / 'python/Python311', package / 'python/Python311')
        runtime = package / 'runtime/norllama'
        runtime.mkdir(parents=True)
        for name in ('norllama.py', 'owned_process.py'):
            shutil.copy2(ROOT / 'runtime/norllama' / name, runtime / name)
        engine = package / 'engine/norama'
        engine.mkdir(parents=True)
        shutil.copy2(ROOT / 'engine/norama/norama-dualtrace-worker.exe', engine)
        models = package / 'models'
        models.mkdir()
        shutil.copy2(ROOT / 'models/nori-development/dualtrace-instructions-4nbseb8_/weights.ndt', models)
        config = {'architecture': 'nori-dualtrace-v0', 'port': 11436,
                  'engine_binary': 'engine/norama/norama-dualtrace-worker.exe',
                  'model_path': 'models/weights.ndt', 'model_id': 'nori-relocated-development'}
        config_path = runtime / 'config.json'
        config_path.write_text(json.dumps(config), encoding='utf-8')
        key = secrets.token_urlsafe(48)
        environment = dict(os.environ, NORI_RUNTIME_API_KEY=key, PYTHONNOUSERSITE='1',
                           PYTHONPATH='', PYTHONHOME=str(package / 'python/Python311'))
        check = subprocess.run([str(package / 'python/Python311/python.exe'), '-I', '-B', '-c',
            'import sys,json,ssl,ctypes; print(json.dumps({"prefix":sys.prefix,"executable":sys.executable}))'],
            cwd=package, env=environment, capture_output=True, text=True, timeout=10, check=True)
        interpreter = json.loads(check.stdout)
        if Path(interpreter['prefix']).resolve() != package / 'python/Python311':
            raise RuntimeError('Interpreter prefix is not relocated')
        process = subprocess.Popen([str(package / 'python/Python311/python.exe'), '-B',
            str(runtime / 'norllama.py'), '--config', str(config_path),
            '--experimental-own-model', '--port', '0', '--supervised'],
            cwd=package, env=environment, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL, text=True, creationflags=subprocess.CREATE_NO_WINDOW)
        lines = queue.Queue()
        reader = threading.Thread(target=lambda: lines.put(process.stdout.readline()), daemon=True)
        reader.start()
        ready = json.loads(lines.get(timeout=15))
        port = ready['port']
        connection = http.client.HTTPConnection('127.0.0.1', port, timeout=10)
        try:
            connection.request('POST', '/v1/experimental/chat', json.dumps({
                'model_id': config['model_id'], 'messages': [{'role':'user','content':'Add 1 and 2.'}],
                'max_tokens':32,'stream':False}),
                {'Authorization':'Bearer '+key,'Content-Type':'application/json'})
            response = connection.getresponse()
            body = json.loads(response.read())
            if response.status != 200 or not isinstance(body.get('text'), str):
                raise RuntimeError('Relocated service response failed')
        finally:
            connection.close()
        process.stdin.close()
        if process.wait(timeout=10) != 0:
            raise RuntimeError('Relocated runtime did not exit cleanly')
        reader.join(timeout=2)
        process.stdout.close()
        evidence = {'relocated_own_runtime':'PASS','authenticated_generation':'PASS',
            'runtime_exit':0,'reply':body['text'],'assistant_qualified':False,
            'complete_suite_installer_qualified':False,'relocated_interpreter_prefix_checked':True,
            'package_file_sha256': {str(p.relative_to(package)): sha256(p.read_bytes()).hexdigest()
                for p in (runtime/'norllama.py',runtime/'owned_process.py',config_path,
                          engine/'norama-dualtrace-worker.exe',models/'weights.ndt',
                          package/'python/Python311/python.exe')},
            'probe_sha256':sha256(Path(__file__).read_bytes()).hexdigest()}
    finally:
        if process and process.poll() is None:
            if process.stdin and not process.stdin.closed:
                process.stdin.close()
            try: process.wait(timeout=10)
            except subprocess.TimeoutExpired:
                process.kill();process.wait(timeout=5)
        if package.parent != parent or not package.name.startswith('.native-package-probe-'):
            raise RuntimeError('Cleanup scope invalid')
        shutil.rmtree(package)
    evidence['temporary_package_cleanup']='PASS'
    if receipt:
        with receipt.open('x',encoding='utf-8') as handle:
            json.dump(evidence,handle,indent=2,allow_nan=False)
    print(json.dumps(evidence))


if __name__ == '__main__':
    parser=argparse.ArgumentParser()
    parser.add_argument('--receipt',type=Path)
    main(parser.parse_args().receipt)
