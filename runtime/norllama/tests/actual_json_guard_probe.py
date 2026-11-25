"""Real syntax-mode failure/cancellation/reuse probe; no HTTP, tools or grants."""
import json
from pathlib import Path
import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parent))
from norllama import WorkerClient, RuntimeCancelled
from actual_candidate_probe import digest, generate, ROOT


def main():
    checkpoint = ROOT / 'models/language/llama3.2-3b-instruct/llama3.2-3b-instruct.gguf'
    expected = 'dde5aa3fc5ffc17176b5e8bdc82f587b24b2678c6c66101bf7da77af9f7ccdff'
    if digest(checkpoint) != expected:
        raise ValueError('Default checkpoint changed; no worker started')
    worker = ROOT / 'engine/norama/norama-worker.exe'
    client = WorkerClient([str(worker), str(checkpoint)], ROOT)
    worker_hash = digest(worker)
    try:
        sample = generate(client, [{'role': 'user', 'content': 'Return a JSON object with hello set to world.'}],
                          64, json_object=True)
        value = json.loads(sample['text'])
        if not isinstance(value, dict) or sample['metrics']['finish_reason'] != 'stop':
            raise AssertionError('Syntax generation did not produce a complete object')
        print(json.dumps({'syntax_sample': sample, 'worker_pid': client.process.pid}), flush=True)
        long_request = [{'role': 'user', 'content':
                         'Return a JSON object with items containing the integers from 1 through 1000.'}]
        try:
            generate(client, long_request, 1, json_object=True)
        except RuntimeError as error:
            if str(error) != 'JSON-object generation exhausted output budget before completion':
                raise
        else:
            raise AssertionError('Actual one-token case did not exercise incomplete-object failure')
        print(json.dumps({'incomplete_object_failed_explicitly': 'PASS'}), flush=True)
        cancelled = False
        with client.request(long_request, 512, json_object=True) as request:
            while not request.complete:
                kind, _ = request.next()
                if kind == 'token':
                    if not client.cancel(request.id):
                        raise AssertionError('Failed to cancel owned JSON request')
                    break
            try:
                while not request.complete:
                    request.next()
            except RuntimeCancelled:
                cancelled = True
        if not cancelled:
            raise AssertionError('Actual JSON request was not cancelled')
        reply = generate(client, [{'role': 'user', 'content': 'Just say hello.'}], 32)
        if not reply['text'].strip() or reply['metrics']['finish_reason'] != 'stop':
            raise AssertionError('Ordinary chat did not recover on the same worker')
        print(json.dumps({'syntax_cancel_reuse': 'PASS', 'ordinary_reply': reply,
                          'same_worker_pid': client.process.pid, 'tools_executed': 0}), flush=True)
    finally:
        client.close()
        if client.process.poll() != 0:
            raise RuntimeError('Owned syntax probe worker did not close cleanly')
    print(json.dumps({'worker_sha256': worker_hash, 'model_sha256': expected,
                      'owned_cleanup': 'PASS', 'schema_or_semantics_qualified': False}), flush=True)


if __name__ == '__main__':
    main()
