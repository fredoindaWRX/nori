"""Explicit live desktop check for follow-ups submitted before a reply finishes."""
import argparse
import hashlib
import json
from pathlib import Path
import time
from uuid import uuid4

from tools.capability_acceptance import request, TERMINAL

ROOT = Path(__file__).resolve().parents[1]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--write-note', action='store_true')
    args = parser.parse_args()
    token = (ROOT / 'runtime-data/secrets/council-token').read_text().strip()
    conversation = 'pending-context-' + uuid4().hex
    first = request('/work', token, {
        'goal': 'For this test conversation, the example car is a blue 2017 Subaru WRX. Acknowledge in one short sentence. Do not use tools or change any files.',
        'conversation_id': conversation, 'request_id': uuid4().hex})
    observed = request('/work/' + first['task_id'], token)
    second = request('/work', token, {
        'goal': ('Save a note named example-car.txt in this task workspace describing that car: its color, year, make and model. Read the saved note back to verify it.' if args.write_note else
                 'What color, year, make and model was that car? Answer from our conversation in one sentence; do not use tools or change files.'),
        'conversation_id': conversation, 'request_id': uuid4().hex})
    states = {first['task_id']: first, second['task_id']: second}
    deadline = time.monotonic() + 180
    while time.monotonic() < deadline:
        for task_id in states:
            states[task_id] = request('/work/' + task_id, token)
        if all(s['status'] in TERMINAL for s in states.values()):
            break
        time.sleep(2)
    timed_out = any(s['status'] not in TERMINAL for s in states.values())
    if timed_out:
        for task_id, state in states.items():
            if state['status'] not in TERMINAL:
                request('/work/' + task_id + '/cancel', token, {})
    answer = states[second['task_id']].get('response', '')
    artifact_evidence = []
    if args.write_note:
        workspace = (ROOT / 'runtime-data/neo/workspace/tasks' / second['task_id']).resolve()
        for artifact in states[second['task_id']].get('artifacts', []):
            if artifact.get('name') != 'example-car.txt':
                continue
            path = Path(artifact['path']).resolve()
            if path.parent != workspace or not path.is_file():
                continue
            raw = path.read_bytes()
            content = raw.decode('utf-8')
            artifact_evidence.append({'path': str(path), 'content': content,
                'sha256': hashlib.sha256(raw).hexdigest(),
                'hash_matches': hashlib.sha256(raw).hexdigest() == artifact['sha256']})
        answer = artifact_evidence[0]['content'] if artifact_evidence else ''
    passed = (not timed_out and observed['status'] not in TERMINAL
              and states[second['task_id']]['status'] == 'completed'
              and all(word in answer.lower() for word in ['blue', '2017', 'subaru', 'wrx']))
    if args.write_note:
        passed = passed and bool(artifact_evidence) and all(a['hash_matches'] for a in artifact_evidence)
    report = {'passed': passed, 'scope': 'live desktop overlapping conversation reference resolution; no file or hardware action',
              'first_status_before_followup': observed['status'], 'timed_out': timed_out,
              'conversation_id': conversation, 'artifact_evidence': artifact_evidence,
              'tasks': [{'task_id': s['task_id'], 'status': s['status'], 'response': s.get('response', '')}
                        for s in states.values()]}
    if args.write_note:
        report['scope'] = 'live overlapping conversation to file creation; saved bytes and recorded hash independently verified'
    filename = 'pending-context-tool-acceptance.json' if args.write_note else 'pending-context-live-acceptance.json'
    encoded = json.dumps(report, indent=2)
    receipts = ROOT / 'runtime-data/context-acceptance-receipts'
    receipts.mkdir(exist_ok=True)
    (receipts / (conversation + '.json')).write_text(encoded, encoding='utf-8')
    (ROOT / 'runtime-data' / filename).write_text(encoded, encoding='utf-8')
    print(json.dumps(report, indent=2), flush=True)
    return 0 if passed else 1


if __name__ == '__main__':
    raise SystemExit(main())
