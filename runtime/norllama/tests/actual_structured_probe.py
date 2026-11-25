"""Real GPU output qualification; no tools, owner data, or persistent grants."""
import json
import os
from pathlib import Path
import secrets
import socket
import subprocess
import sys
import time
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parents[3] / 'nori'))
from core_client import NativeInferenceClient
from structured_output import parse_output, contract_messages
from work_contracts import action_schema, PLAN_SCHEMA
from desktop_task_graph import validate as validate_graph

root = Path(__file__).resolve().parents[3]
port = 11435
with socket.socket() as check:
    if check.connect_ex(('127.0.0.1', port)) == 0:
        raise RuntimeError('Qualification port occupied; not replacing any service')
key = secrets.token_urlsafe(32)
process = subprocess.Popen([sys.executable, '-B', str(root / 'runtime/norllama/norllama.py')],
    cwd=root, env={**os.environ, 'NORI_RUNTIME_API_KEY': key},
    stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
    creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
client = NativeInferenceClient(f'http://127.0.0.1:{port}', key, 'llama3.2-3b-instruct')
try:
    deadline = time.monotonic() + 30
    while True:
        if process.poll() is not None: raise RuntimeError('Owned runtime exited before readiness')
        try:
            health = client.health()
            if health['ready']: break
        except (OSError, RuntimeError): pass
        if time.monotonic() > deadline: raise TimeoutError('Runtime readiness deadline')
        time.sleep(0.1)
    cases = [
        ('finish', action_schema({'finish', 'blocked'}), 'The observed test result is PASS. Finish with a short summary.'),
        ('read', action_schema({'read_file', 'blocked'}), 'Propose reading task-local file notes.txt. No contents have been observed.'),
        ('plan', PLAN_SCHEMA, 'Plan one read-only step: Neo reads task-local notes.txt using read_file. Require tool evidence. Do not claim it was read.'),
    ]
    results = []
    for name, schema, task in cases:
        generated = client.generate(contract_messages(task, schema), 512)
        try:
            if generated['metrics']['finish_reason'] != 'stop': raise ValueError('Output truncated')
            parsed = parse_output(generated['text'], schema)
            if name == 'read' and parsed.get('path') != 'notes.txt': raise ValueError('Requested path not preserved')
            if name == 'finish' and parsed.get('action') != 'finish': raise ValueError('Did not finish observed success')
            if name == 'plan':
                graph = validate_graph(parsed['tasks'])
                if len(graph) != 1 or any('read_file' not in node['task'] or 'notes.txt' not in node['task']
                                          or node['verify'] != 'tool' for node in graph):
                    raise ValueError('Plan did not preserve requested read and evidence requirement')
        except ValueError as error:
            results.append({'case': name, 'status': 'REJECTED', 'reason': str(error), 'output': generated['text']})
        else:
            results.append({'case': name, 'status': 'PASS', 'output': parsed})
    print(json.dumps({'structured_cases': results, 'runtime_pid': process.pid,
                      'model_id': client.model_id, 'tools_executed': 0}))
    if any(result['status'] != 'PASS' for result in results):
        raise SystemExit(2)  # A completed probe is not successful qualification.
finally:
    import http.client
    connection = http.client.HTTPConnection('127.0.0.1', port, timeout=5)
    try:
        connection.request('POST', '/v1/shutdown', '{}', {'Authorization': 'Bearer ' + key, 'Content-Type': 'application/json'})
        connection.getresponse().read()
        process.wait(timeout=10)
    finally:
        connection.close()
        if process.poll() is None:
            process.terminate()
            process.wait(timeout=5)
