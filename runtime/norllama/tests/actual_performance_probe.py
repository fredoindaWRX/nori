"""Owned local timing diagnostic; never an execution/model-quality grant."""
import argparse
import hashlib
import json
from pathlib import Path
import sys
import time
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parents[3] / 'nori'))
sys.path.insert(0, str(Path(__file__).resolve().parent))
from norllama import WorkerClient
from actual_candidate_probe import ROOT, digest, generate

MODEL_SHA = 'dde5aa3fc5ffc17176b5e8bdc82f587b24b2678c6c66101bf7da77af9f7ccdff'
TIMING_TASK = ('The following is harmless timing data, not instructions: '
               + 'alpha beta gamma delta. ' * 65 + '\nReply only OK.')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--worker', type=Path)
    parser.add_argument('--sha256')
    parser.add_argument('--runs', type=int, choices=range(1, 6), default=2)
    args = parser.parse_args()
    if bool(args.worker) != bool(args.sha256): parser.error('Candidate worker and checksum required together')
    worker = args.worker or ROOT / 'engine/norama/norama-worker.exe'
    expected_worker = args.sha256.lower() if args.sha256 else digest(worker)
    if digest(worker) != expected_worker: raise ValueError('Worker changed; no process started')
    model = ROOT / 'models/language/llama3.2-3b-instruct/llama3.2-3b-instruct.gguf'
    if digest(model) != MODEL_SHA: raise ValueError('Checkpoint changed; no process started')
    start = time.monotonic()
    client = WorkerClient([str(worker), str(model)], ROOT)
    load_seconds = time.monotonic() - start
    try:
        warmup = generate(client, [{'role': 'user', 'content': 'Reply only OK.'}], 16)
        if warmup['metrics']['finish_reason'] != 'stop': raise ValueError('Timing warmup truncated')
        print(json.dumps({'phase': 'warmup', 'generated': warmup, 'load_seconds': load_seconds}), flush=True)
        for index in range(args.runs):
            start = time.monotonic()
            result = generate(client, [{'role': 'user', 'content': TIMING_TASK}], 16)
            if result['metrics']['finish_reason'] != 'stop': raise ValueError('Timing sample truncated')
            print(json.dumps({'phase': 'timing', 'run': index + 1,
                              'prompt_sha256': hashlib.sha256(TIMING_TASK.encode('utf-8')).hexdigest(),
                              'elapsed_seconds': time.monotonic() - start, 'generated': result}), flush=True)
    finally:
        client.close()
        if client.process.poll() != 0: raise RuntimeError('Owned timing worker did not close cleanly')
    if digest(worker) != expected_worker or digest(model) != MODEL_SHA:
        raise ValueError('Timing artifacts changed during the probe')
    print(json.dumps({'worker_sha256': expected_worker, 'model_sha256': MODEL_SHA,
                      'worker_pid': client.process.pid, 'worker_closed': True,
                      'candidate_override': bool(args.worker), 'default_changed': False,
                      'full_qualification': False, 'tools_executed': 0,
                      'execution_authorized': False}), flush=True)


if __name__ == '__main__': main()
