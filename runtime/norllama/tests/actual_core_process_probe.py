"""Real supervised Core process against an already owned native test runtime.

Uses fresh state/ports and no sensors, tools, owner memory or production config
mutation. This is not installed-app or durable-task acceptance.
"""
import http.client
import json
import os
from pathlib import Path
import secrets
import socket
import subprocess
import sys
import tempfile
import time

root = Path(__file__).resolve().parents[3]
endpoint = os.environ['NORI_TEST_ENDPOINT']
runtime_key = os.environ['NORI_TEST_KEY']
core_key = secrets.token_urlsafe(32)
config = json.loads((root / 'nori/config.yaml').read_text(encoding='utf-8'))
config['native_inference'] = {'model_id': 'llama3.2-3b-instruct',
    'assignments': {name: 'llama3.2-3b-instruct' for name in config['knights']}}
config['sensors'] = []
reservations = []
process = None

def call(port, path, body=None, authorized=True):
    connection = http.client.HTTPConnection('127.0.0.1', port, timeout=30)
    try:
        headers = {'Content-Type': 'application/json'}
        if authorized: headers['Authorization'] = 'Bearer ' + core_key
        connection.request('GET' if body is None else 'POST', path,
            None if body is None else json.dumps(body), headers)
        response = connection.getresponse()
        return response.status, json.loads(response.read(1048576))
    finally: connection.close()

with tempfile.TemporaryDirectory(prefix='.native-process-probe-', dir=root / 'verification') as directory:
    state = Path(directory)
    try:
        for name in config['startup_order']:
            reservation = socket.socket()
            reservation.bind(('127.0.0.1', 0))
            reservations.append(reservation)
            config['knights'][name]['port'] = reservation.getsockname()[1]
            config['knights'][name]['options'] = {**config['knights'][name].get('options', {}), 'num_predict': 4}
        config_path = state / 'candidate-config.json'
        config_path.write_text(json.dumps(config), encoding='utf-8')
        for reservation in reservations: reservation.close()
        process = subprocess.Popen([sys.executable, '-B', str(root / 'nori/main.py'),
            '--config', str(config_path), '--supervised'], cwd=root,
            env={**os.environ, 'NORI_DATA_ROOT': str(state / 'state'), 'NORI_API_TOKEN': core_key,
                 'NORI_INFERENCE_RUNTIME': 'norllama', 'NORI_RUNTIME_URL': endpoint,
                 'NORI_RUNTIME_API_KEY': runtime_key,
                 'NORI_LETTA_TOKEN_FILE': str(state / 'no-owner-memory-token')},
            stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
            creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
        deadline = time.monotonic() + 30
        for name in config['startup_order']:
            port = config['knights'][name]['port']
            while True:
                if process.poll() is not None: raise AssertionError('Owned Core exited before readiness')
                try:
                    status, result = call(port, '/health')
                    if status == 200 and result['knight'] == name and result['model_ready'] is True: break
                except (OSError, http.client.HTTPException): pass
                if time.monotonic() > deadline: raise TimeoutError('Supervised Core readiness deadline')
                time.sleep(0.05)
            assert call(port, '/health', authorized=False)[0] == 401
        status, answer = call(config['knights']['architect']['port'], '/chat', {'goal': 'Say hello.'})
        assert status == 200 and answer['status'] == 'completed' and answer['response'].strip()
        assert answer['inference']['backend'] == 'norama-independent'
        process.stdin.close()
        assert process.wait(timeout=30) == 0
        stdout, stderr = process.stdout.read(), process.stderr.read()
        assert len(stdout) + len(stderr) < 65536
        assert core_key.encode() not in stdout + stderr and runtime_key.encode() not in stdout + stderr
        assert b'Core shutdown incomplete' not in stdout
        for name in config['startup_order']:
            with socket.socket() as check:
                assert check.connect_ex(('127.0.0.1', config['knights'][name]['port'])) != 0
        print(json.dumps({'supervised_core_process': 'PASS', 'twelve_http_routes': 'PASS',
                          'real_architect_chat': 'PASS', 'parent_eof_shutdown': 'PASS',
                          'ports_closed': 'PASS', 'private_key_leak': False,
                          'core_pid': process.pid, 'exit': process.returncode,
                          'sensors_enabled': 0, 'tools_executed': 0}))
    finally:
        for reservation in reservations: reservation.close()
        if process is not None:
            if process.poll() is None:
                if process.stdin and not process.stdin.closed: process.stdin.close()
                try: process.wait(timeout=30)
                except subprocess.TimeoutExpired:
                    process.terminate()
                    process.wait(timeout=5)
            for stream in [process.stdout, process.stderr]:
                if stream: stream.close()
