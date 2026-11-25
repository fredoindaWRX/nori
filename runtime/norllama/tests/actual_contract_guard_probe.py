"""Real own contract-mode budget/cancel/reuse test; no HTTP, tools or grants."""
import hashlib
import json
from pathlib import Path
import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parent))
from norllama import WorkerClient, RuntimeCancelled
from contract_grammar import compile_grammar
from structured_output import parse_output
from actual_candidate_probe import digest, generate, ROOT


def main():
    checkpoint = ROOT / 'models/language/llama3.2-3b-instruct/llama3.2-3b-instruct.gguf'
    expected = 'dde5aa3fc5ffc17176b5e8bdc82f587b24b2678c6c66101bf7da77af9f7ccdff'
    if digest(checkpoint) != expected: raise ValueError('Checkpoint changed; no worker started')
    worker = ROOT / 'engine/norama/norama-worker.exe'
    worker_hash = digest(worker)
    client = WorkerClient([str(worker), str(checkpoint)], ROOT)
    schema = {'type': 'object', 'properties': {'message': {'type': 'string', 'minLength': 1, 'maxLength': 200}},
              'required': ['message'], 'additionalProperties': False}
    # Exact long value tests mechanical guard/budget behavior, NOT model quality.
    long_schema = {'type': 'object', 'properties': {'test': {'const': 'test-value-' * 100}},
                   'required': ['test'], 'additionalProperties': False}
    messages = [{'role': 'user', 'content': 'Return one JSON object with message containing a short greeting.'}]
    try:
        sample = generate(client, messages, 64, contract_schema=schema)
        parse_output(sample['text'], schema)
        if sample['metrics']['finish_reason'] != 'stop': raise AssertionError('Guard sample did not finish')
        print(json.dumps({'contract_sample': sample, 'worker_pid': client.process.pid,
                          'program_sha256': hashlib.sha256(compile_grammar(schema)).hexdigest()}), flush=True)
        try:
            generate(client, messages, 1, contract_schema=long_schema)
        except RuntimeError as error:
            if str(error) != 'JSON-object generation exhausted output budget before completion': raise
        else: raise AssertionError('Incomplete contract was reported successful')
        print(json.dumps({'contract_budget_refusal': 'PASS'}), flush=True)
        cancelled = False
        with client.request(messages, 512, contract_schema=long_schema) as request:
            while not request.complete:
                kind, _ = request.next()
                if kind == 'token':
                    if not client.cancel(request.id): raise AssertionError('Contract request cancel refused')
                    break
            try:
                while not request.complete: request.next()
            except RuntimeCancelled: cancelled = True
        if not cancelled: raise AssertionError('Contract request did not cancel')
        ordinary = generate(client, [{'role': 'user', 'content': 'Just say hello.'}], 32)
        if not ordinary['text'].strip() or ordinary['metrics']['finish_reason'] != 'stop':
            raise AssertionError('Ordinary chat did not recover')
        after = generate(client, messages, 64, contract_schema=schema)
        parse_output(after['text'], schema)
        if after['metrics']['finish_reason'] != 'stop': raise AssertionError('Contract state did not reset')
        print(json.dumps({'contract_cancel_reuse': 'PASS', 'ordinary_reply': ordinary,
                          'next_contract_reply': after, 'same_worker_pid': client.process.pid,
                          'tools_executed': 0}), flush=True)
    finally:
        client.close()
        if client.process.poll() != 0: raise RuntimeError('Owned contract worker did not close cleanly')
    print(json.dumps({'worker_sha256': worker_hash, 'model_sha256': expected,
                      'owned_cleanup': 'PASS', 'task_execution_qualified': False}), flush=True)


if __name__ == '__main__': main()
