"""Exercise the real authenticated desktop API; never treats prose as tool proof.

Run explicitly on the owner's machine. Produces local test artifacts only.
"""
import argparse
import json
from pathlib import Path
import time
from urllib.request import Request, urlopen
from uuid import uuid4

ROOT = Path(__file__).resolve().parents[1]


def request(path, token, body=None):
    data = None if body is None else json.dumps(body).encode()
    req = Request('http://127.0.0.1:9107' + path, data=data,
                  headers={'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json'})
    with urlopen(req, timeout=20) as response:
        return json.load(response)


def run(output, timeout=300):
    token = (ROOT / 'runtime-data/secrets/council-token').read_text().strip()
    conversation = str(uuid4())
    cases = [
        ('greeting', 'hey', set()),
        ('source_discovery', 'Find the definition of WorkSessionManager in the nori folder of our project. '
         'Use project_search, then read the matching source file. Tell me the constructor defaults for max_steps and max_segments. '
         'Do not edit any files.', {'project_search', 'project_read'}),
        ('write_and_verify', 'Create acceptance-note.txt in this task containing exactly: NORI verified local artifact. '
         'Read the saved file back and report its path.', {'write', 'read'}),
        ('conversation_recall', 'What were the two constructor defaults you found earlier in this conversation?', set()),
    ]
    report = {'schema': 'nori.desktop-acceptance.v1', 'started_at': time.time(),
              'scope': 'Four bounded desktop tasks; not universal capability parity.', 'cases': []}
    output.parent.mkdir(parents=True, exist_ok=True)
    for name, goal, required in cases:
        began = time.monotonic()
        state = request('/work', token, {'goal': goal, 'conversation_id': conversation, 'request_id': uuid4().hex})
        task = state['task_id']
        print(json.dumps({'case': name, 'task_id': task, 'status': 'started'}), flush=True)
        while state['status'] not in {'completed', 'failed', 'blocked', 'cancelled', 'interrupted'}:
            if time.monotonic() - began > timeout:
                request('/work/' + task + '/cancel', token, {})
                break
            time.sleep(2)
            state = request('/work/' + task, token)
        operations = {item['operation'] for item in state.get('executed_tools', [])}
        passed = state['status'] == 'completed' and required <= operations
        if name == 'source_discovery':
            passed = passed and '12' in state.get('response', '') and '8' in state.get('response', '')
        if name == 'write_and_verify':
            artifacts = state.get('artifacts', [])
            passed = passed and any(Path(a['path']).is_file() and
                Path(a['path']).read_text().strip() == 'NORI verified local artifact.' for a in artifacts)
        if name == 'conversation_recall':
            passed = passed and '12' in state.get('response', '') and '8' in state.get('response', '')
        case = {'name': name, 'task_id': task, 'passed': passed, 'status': state['status'],
                'duration_seconds': round(time.monotonic() - began, 2),
                'operations': sorted(operations), 'response': state.get('response', ''),
                'generation_calls': len(state.get('model_calls', []))}
        report['cases'].append(case)
        report['passed'] = all(c['passed'] for c in report['cases'])
        output.write_text(json.dumps(report, indent=2), encoding='utf-8')
        print(json.dumps(case), flush=True)
    return report['passed']


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--output', type=Path, default=ROOT / 'runtime-data/desktop-acceptance.json')
    args = parser.parse_args()
    raise SystemExit(0 if run(args.output) else 1)
