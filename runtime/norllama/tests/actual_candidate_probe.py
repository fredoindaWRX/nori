"""Explicit read-only candidate evaluation; never selects a production model.

Uses the owned binary worker directly, no HTTP listener, tools or model copies.
The strict contract checks are identical to actual_structured_probe.py.
"""
import argparse
import hashlib
import json
from pathlib import Path
import sys
import time

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / 'runtime/norllama'))
sys.path.insert(0, str(ROOT / 'nori'))
from norllama import WorkerClient
from structured_output import parse_output, contract_messages
from work_contracts import action_schema, PLAN_SCHEMA
from desktop_task_graph import validate as validate_graph


def digest(path):
    with path.open('rb') as source:
        return hashlib.file_digest(source, 'sha256').hexdigest()


def generate(client, messages, limit, *, json_object=False, contract_schema=None):
    chunks, metrics = [], None
    try:
        with client.request(messages, limit, json_object=json_object, contract_schema=contract_schema) as request:
            while not request.complete:
                kind, value = request.next()
                if kind == 'token':
                    chunks.append(value)
                elif kind == 'metrics':
                    metrics = value
    except RuntimeError as error:
        # Diagnostic only, never repaired/accepted as a completed proposal.
        error.partial_output = ''.join(chunks)
        raise
    return {'text': ''.join(chunks), 'metrics': metrics}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--checkpoint', type=Path, required=True)
    parser.add_argument('--sha256', required=True)
    parser.add_argument('--model-id', required=True)
    parser.add_argument('--json-object', action='store_true', help='Exercise experimental syntax-only token guard; not tool qualification')
    args = parser.parse_args()
    checkpoint = args.checkpoint.resolve(strict=True)
    observed = digest(checkpoint)
    if observed != args.sha256.lower():
        raise ValueError('Candidate checksum mismatch; no worker started')
    worker = ROOT / 'engine/norama/norama-worker.exe'
    worker_hash = digest(worker)
    started = time.monotonic()
    client = WorkerClient([str(worker), str(checkpoint)], ROOT)
    startup_seconds = time.monotonic() - started
    results = []
    try:
        health = client.health()
        hello = generate(client, [{'role': 'user', 'content': 'Just say hello.'}], 32)
        if not hello['text'].strip() or hello['metrics']['finish_reason'] != 'stop':
            raise ValueError('Candidate basic conversation did not finish')
        print(json.dumps({'chat': hello, 'health': health, 'startup_seconds': startup_seconds}), flush=True)
        cases = [
            ('finish', action_schema({'finish', 'blocked'}), 'The observed test result is PASS. Finish with a short summary.'),
            ('read', action_schema({'read_file', 'blocked'}), 'Propose reading task-local file notes.txt. No contents have been observed.'),
            ('plan', PLAN_SCHEMA, 'Plan one read-only step: Neo reads task-local notes.txt using read_file. Require tool evidence. Do not claim it was read.'),
        ]
        for name, schema, task in cases:
            try:
                generated = generate(client, contract_messages(task, schema), 512, json_object=args.json_object)
            except RuntimeError as error:
                result = {'case': name, 'status': 'REJECTED', 'reason': str(error), 'generation_failed': True}
                results.append(result)
                print(json.dumps(result), flush=True)
                continue
            try:
                if generated['metrics']['finish_reason'] != 'stop':
                    raise ValueError('Output truncated')
                parsed = parse_output(generated['text'], schema)
                if name == 'read' and parsed.get('path') != 'notes.txt':
                    raise ValueError('Requested path not preserved')
                if name == 'finish' and parsed.get('action') != 'finish':
                    raise ValueError('Did not finish observed success')
                if name == 'plan':
                    graph = validate_graph(parsed['tasks'])
                    if len(graph) != 1 or any('read_file' not in node['task'] or 'notes.txt' not in node['task']
                                              or node['verify'] != 'tool' for node in graph):
                        raise ValueError('Plan did not preserve requested read and evidence requirement')
            except ValueError as error:
                result = {'case': name, 'status': 'REJECTED', 'reason': str(error), **generated}
            else:
                result = {'case': name, 'status': 'PASS', 'parsed': parsed, **generated}
            results.append(result)
            print(json.dumps(result), flush=True)
    finally:
        client.close()
        if client.process.poll() != 0:
            raise RuntimeError('Owned candidate worker did not shut down cleanly')
    print(json.dumps({'model_id': args.model_id, 'model_sha256': observed,
                      'worker_sha256': worker_hash, 'worker_closed': True,
                      'json_syntax_guard': args.json_object,
                      'tools_executed': 0, 'default_changed': False,
                      'structured_passes': sum(item['status'] == 'PASS' for item in results),
                      'structured_cases': len(results)}), flush=True)
    return 0 if all(item['status'] == 'PASS' for item in results) else 2


if __name__ == '__main__':
    raise SystemExit(main())
