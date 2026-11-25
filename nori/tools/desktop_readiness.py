"""Bounded local checks for desktop task readiness; never prints credentials.

Listening, model availability, task intake, memory and execution are separate
facts. No report from this helper claims that every Knight skill is functional.
"""
from __future__ import annotations

import argparse
import ast
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
import json
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import ProxyHandler, Request, build_opener

ROOT = Path(__file__).resolve().parents[1]


def local_json(url, token=None, timeout=3):
    # Callers build endpoints only from validated local configuration.
    from ipaddress import ip_address
    from urllib.parse import urlsplit
    address = urlsplit(url)
    if (address.scheme != 'http' or address.username or address.password or
            address.fragment or address.hostname != 'localhost' and
            not ip_address(address.hostname).is_loopback):
        raise ValueError('Only loopback checks are allowed')
    headers = {'Authorization': 'Bearer ' + token} if token else {}
    try:
        with build_opener(ProxyHandler({})).open(Request(url, headers=headers), timeout=timeout) as response:
            raw = response.read(262145)
            if len(raw) > 262144:
                raise ValueError('Oversized readiness response')
            try:
                body = json.loads(raw)
            except ValueError:
                body = {'text': raw.decode(errors='replace')[:100]}
            return {'reachable': True, 'http_status': response.status, 'body': body}
    except HTTPError as error:
        return {'reachable': True, 'http_status': error.code, 'error': 'http_error'}
    except (OSError, ValueError) as error:
        return {'reachable': False, 'error': type(error).__name__}


def source_revision(root):
    """Read the deployed source version without importing the running service."""
    tree = ast.parse((Path(root) / 'work_sessions.py').read_text(encoding='utf-8-sig'))
    for node in tree.body:
        if isinstance(node, ast.ClassDef) and node.name == 'WorkSessionManager':
            for item in node.body:
                if isinstance(item, ast.Assign) and any(
                    isinstance(target, ast.Name) and target.id == 'RUNTIME_REVISION'
                    for target in item.targets
                ) and isinstance(item.value, ast.Constant) and isinstance(item.value.value, str):
                    return item.value.value
    raise ValueError('Work runtime source revision is missing')


def summarize(knights, model_probe, memory_probe, token_present, expected_revision=None):
    all_listening = len(knights) == 12 and all(
        result.get('http_status') == 200 and result.get('body', {}).get('knight') == name
        for name, result in knights.items())
    all_models = all_listening and all(result['body'].get('model_ready') is True for result in knights.values())
    architect = knights.get('architect', {}).get('body', {})
    work_available = all_models and token_present and architect.get('work_available') is True
    running_revision = (architect.get('work_runtime') or {}).get('revision')
    current = expected_revision is not None and running_revision == expected_revision
    # NORI Home uses the Merovingian's native, scoped JSONL store as its
    # primary persistence service.  Letta is an optional compatibility
    # adapter, never a prerequisite for a local desktop to retain memory.
    memory_available = memory_probe.get('http_status') == 200
    blockers = []
    if not all_listening: blockers.append('council_not_all_listening')
    if not all_models: blockers.append('model_service_or_assignments_unavailable')
    if not token_present: blockers.append('council_identity_missing')
    if not architect.get('work_available'): blockers.append('desktop_work_api_not_ready')
    if not memory_available: blockers.append('persistent_memory_service_unavailable')
    if expected_revision is not None and not current:
        blockers.append('running_work_runtime_outdated')
    return {'council_listening': all_listening, 'assigned_models_available': all_models,
            'desktop_work_available': work_available, 'memory_service_available': memory_available,
            'running_work_revision': running_revision, 'expected_work_revision': expected_revision,
            'work_runtime_current': current,
            'fully_functional': False, 'blockers': blockers,
            'verification_scope': 'service readiness only; task completion requires a real task test'}


def collect(root=ROOT, probe=local_json):
    root = Path(root)
    config = json.loads((root / 'config.yaml').read_text(encoding='utf-8'))
    secret = root / 'runtime-data/secrets/council-token'
    token = secret.read_text(encoding='utf-8').strip() if secret.is_file() else None
    token_present = bool(token and len(token) >= 32)
    def knight(name):
        port = config['knights'][name]['port']
        if type(port) is not int or not 1024 <= port <= 65535:
            raise ValueError('Invalid Knight port')
        return name, probe(f'http://127.0.0.1:{port}/health', token=token)
    with ThreadPoolExecutor(max_workers=12) as workers:
        knights = dict(workers.map(knight, config['startup_order']))
    models = probe(config['ollama_url'].rstrip('/') + '/api/tags')
    memory_backend = config.get('memory', {}).get('primary_backend', 'nori-local-jsonl')
    if memory_backend == 'nori-local-jsonl':
        memory = dict(knights.get('merovingian', {}))
        memory['backend'] = memory_backend
        memory['persistence'] = 'local_scoped_jsonl'
    else:
        memory = probe(config['memory']['letta_base'].rstrip('/') + config['memory'].get('letta_health_path', '/readyz'))
        memory['backend'] = memory_backend
    report = {'schema': 'nori.desktop-readiness.v1',
              'checked_at': datetime.now(timezone.utc).isoformat(),
              'knights': knights, 'models': models, 'memory': memory}
    report.update(summarize(knights, models, memory, token_present, source_revision(root)))
    return report


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--root', type=Path, default=ROOT)
    parser.add_argument('--output', type=Path)
    parser.add_argument('--require-work', action='store_true')
    args = parser.parse_args()
    report = collect(args.root)
    rendered = json.dumps(report, indent=2) + '\n'
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(rendered, encoding='utf-8')
    print(rendered)
    return 1 if args.require_work and (not report['desktop_work_available'] or
                                      not report['work_runtime_current']) else 0


if __name__ == '__main__':
    raise SystemExit(main())
