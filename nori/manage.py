"""Local development commands; reports observations rather than demo status."""
import argparse
from concurrent.futures import ThreadPoolExecutor
import json
import os
from pathlib import Path
import subprocess
import sys
from urllib.request import Request, build_opener, ProxyHandler, HTTPRedirectHandler
from main import ROOT, load_config


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


def request(port, path, body=None):
    headers = {}
    if body is not None:
        token = os.getenv('NORI_API_TOKEN', '')
        if len(token) < 32:
            raise ValueError('Set NORI_API_TOKEN in this terminal first')
        headers = {'Authorization': 'Bearer '+token, 'Content-Type':'application/json'}
    req = Request(f'http://127.0.0.1:{port}{path}',
                  data=None if body is None else json.dumps(body).encode(), headers=headers)
    with build_opener(ProxyHandler({}), NoRedirect()).open(req, timeout=200 if body is not None else 5) as response:
        return json.load(response)


def status(config, knight=None):
    names = [knight] if knight else config['startup_order']
    def inspect(name):
        spec = config['knights'][name]
        try:
            health = request(spec['port'], '/health')
            if health.get('knight') != name:
                return f'{name:13} WRONG SERVICE on port {spec["port"]}'
            state = 'LISTENING' if health.get('model_ready') is True else 'DEGRADED'
            return f'{name:13} {state:10} model={spec["model"]}'
        except Exception as exc:
            return f'{name:13} UNREACHABLE ({type(exc).__name__})'
    with ThreadPoolExecutor(max_workers=12) as pool:
        print('\n'.join(pool.map(inspect, names)))
    print('HTTP/model checks only. TPM, memory counts, hardware and task totals are not verified here.')


def chat(config):
    print('Architect text chat. This endpoint generates replies; it does not dispatch tools. /quit exits.')
    while True:
        try:
            goal = input('> ').strip()
        except (EOFError, KeyboardInterrupt):
            return
        if goal == '/quit': return
        if not goal: continue
        try:
            result = request(config['knights']['architect']['port'], '/chat', {'goal':goal})
            print(result.get('response', 'No response returned'))
        except Exception as exc:
            print(f'Chat failed: {type(exc).__name__}: {exc}')


def tests(knight=None, integration=False):
    if knight:
        return subprocess.call([sys.executable, '-m', 'pytest',
            str(ROOT/'packages'/'knights'/knight/'tests'), '-v'], cwd=ROOT)
    if integration:
        # Simulated adapters and fixtures, not all live services.
        return subprocess.call([sys.executable,'-m','unittest','discover','-s','tests_startup',
                                '-p','test_round_table.py','-v'],cwd=ROOT)
    return subprocess.call([sys.executable,'-m','unittest','discover','-s','tests_startup','-v'],cwd=ROOT)


def main():
    config=load_config(ROOT/'config.yaml')
    parser=argparse.ArgumentParser()
    parser.add_argument('command',choices=['status','chat','test','test-integration','kill',
        'killswitch','memory','test-offline','test-killswitch'])
    parser.add_argument('--knight',choices=list(config['knights']))
    args=parser.parse_args()
    # Make exports variables as environment values; never inject them into code.
    knight=args.knight or os.getenv('KNIGHT') or os.getenv('KNEIGHT') or None
    if knight and knight not in config['knights']: parser.error('Unknown Knight')
    if args.command=='status': status(config,knight)
    elif args.command=='chat': chat(config)
    elif args.command=='test': return tests(knight)
    elif args.command=='test-integration': return tests(integration=True)
    else:
        print(f'{args.command}: not integrated with the live council. No action performed.', file=sys.stderr)
        print('Use make stop for the Compose stack; Ctrl+C for the native launcher.',file=sys.stderr)
        return 2
    return 0


if __name__=='__main__':
    raise SystemExit(main())
