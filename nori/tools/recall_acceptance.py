"""Live saved-conversation recall with a separately invoked seed and recall phase."""
import argparse
import json
from pathlib import Path
import time
from uuid import uuid4
from tools.capability_acceptance import request, TERMINAL

ROOT = Path(__file__).resolve().parents[1]
RECEIPT = ROOT / 'runtime-data/cross-conversation-live-acceptance.json'


def ask(token, goal):
    state = request('/work', token, {'goal': goal, 'conversation_id': uuid4().hex, 'request_id': uuid4().hex})
    deadline = time.monotonic() + 120
    while state['status'] not in TERMINAL:
        if time.monotonic() > deadline:
            request('/work/' + state['task_id'] + '/cancel', token, {})
            raise TimeoutError('Acceptance task exceeded deadline; cancellation requested')
        time.sleep(1)
        state = request('/work/' + state['task_id'], token)
    if state['status'] != 'completed':
        raise RuntimeError('Acceptance task did not complete: ' + state['task_id'])
    return state


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('phase', choices=['seed', 'recall'])
    args = parser.parse_args()
    token = (ROOT / 'runtime-data/secrets/council-token').read_text().strip()
    if args.phase == 'seed':
        state = ask(token, 'What is a made-up single word for an imaginary purple toolbox that sings at sunrise? '
                    'Invent an unusual name, then state what it means in one sentence. This is a fictional memory test, not an owner fact.')
        report = {'seed_task': state['task_id'], 'seed_conversation': state['conversation_id'],
                  'seed_goal': state['goal'], 'seed_response': state['response'], 'passed': False}
    else:
        report = json.loads(RECEIPT.read_text(encoding='utf-8-sig'))
        # Read the persisted source through the restarted service; never supply
        # its contents to the new request. The caller selects the invented word.
        source = request('/work/' + report['seed_task'], token)
        name = report['invented_name']
        assert name.lower() not in report['seed_goal'].lower()
        state = ask(token, 'What did ' + name + ' mean when you mentioned it earlier?')
        answer = state['response'].lower()
        report.update(recall_task=state['task_id'], recall_conversation=state['conversation_id'],
                      recall_response=state['response'], source_persisted=source['response'] == report['seed_response'],
                      passed=all(any(s in answer for s in group) for group in
                                 [('purple', 'amethyst'), ('toolbox', 'kit'), ('sunrise', 'first rays'),
                                  ('sing', 'melod', 'harmon')])
                          and source['response'] == report['seed_response'])
    RECEIPT.write_text(json.dumps(report, indent=2), encoding='utf-8')
    print(json.dumps(report, indent=2), flush=True)
    return 0 if args.phase == 'seed' or report['passed'] else 1


if __name__ == '__main__':
    raise SystemExit(main())
