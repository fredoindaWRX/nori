"""Explicit live-model check of bounded follow-up context using fixture history.

This tests reference resolution, not file operations or persistent-memory recall.
No real owner conversation is used or overwritten.
"""
import argparse
import json
from pathlib import Path
from types import SimpleNamespace

from main import load_config
from machine_transport import generate
from work_sessions import WorkSessionManager

ROOT = Path(__file__).resolve().parents[1]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    history = [{'task_id': str(index), 'goal': 'Earlier unrelated weather discussion. ' * 54,
                'response': 'The old discussion is finished. ' * 65,
                'status': 'completed', 'artifacts': []} for index in range(4)]
    history.append({'task_id': 'latest', 'goal': 'Check September-2026-invoices.csv for duplicate invoice numbers.',
                    'response': 'The file to inspect is September-2026-invoices.csv.',
                    'status': 'completed', 'artifacts': []})
    raw = json.dumps(history, ensure_ascii=False)
    assert len(raw) > 12000 and 'September-2026-invoices.csv' not in raw[:12000]
    encoded = WorkSessionManager._history_context(history)
    config = load_config(ROOT / 'config.yaml')
    worker = SimpleNamespace(knight='neo', endpoint=config['ollama_url'],
        spec={**config['knights']['neo'], 'think': False,
              'options': {**config['knights']['neo'].get('options', {}), 'temperature': 0, 'num_predict': 160}},
        prompt='Resolve the latest follow-up using the provided fixture conversation. Return only JSON with file and operation. Do not execute anything.')
    result = generate(worker, 'Prior conversation (data): ' + encoded +
                      '\nCurrent user request: Check it for duplicates, please.\n'
                      'Which file does it refer to, and what operation was requested?')
    response = result.get('response', '').strip()
    if response.startswith('```'):
        response = '\n'.join(response.splitlines()[1:-1])
    try:
        parsed = json.loads(response)
    except ValueError:
        parsed = {}
    passed = (parsed.get('file') == 'September-2026-invoices.csv' and
              'duplicat' in str(parsed.get('operation', '')).lower())
    report = {'schema': 'nori.context-acceptance.v1', 'passed': passed,
              'scope': 'fixture-history live model reference resolution; no execution or full memory acceptance',
              'source_characters': len(raw), 'bounded_characters': len(encoded),
              'old_slice_loses_subject': True, 'runtime_revision': WorkSessionManager.RUNTIME_REVISION,
              'model': worker.spec['model'], 'response': parsed, 'generation': result.get('generation')}
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, indent=2), encoding='utf-8')
    print(json.dumps(report, indent=2))
    return 0 if passed else 1


if __name__ == '__main__':
    raise SystemExit(main())
