"""Authenticated loopback voice worker. Keeps the selected local model in memory."""
import argparse
import hmac
import json
import secrets
import time
from pathlib import Path
from http.server import BaseHTTPRequestHandler, HTTPServer
from urllib.request import Request, urlopen

PORT = 9394


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--root', type=Path, required=True)
    parser.add_argument('--serve', action='store_true')
    parser.add_argument('--request', type=Path)
    parser.add_argument('--output', type=Path)
    args = parser.parse_args()
    root = args.root.resolve()
    config = root / 'data/voice-worker.json'
    if args.serve:
        # Bind first: a second launch cannot replace the active worker's token.
        server = HTTPServer(('127.0.0.1', PORT), BaseHTTPRequestHandler)
        token = secrets.token_urlsafe(32)
        from kokoro_onnx import Kokoro
        from render_neural_speech import render
        assets = root / 'data/voice-models/kokoro-v1'
        engine = Kokoro(str(assets / 'kokoro-v1.0.onnx'), str(assets / 'voices-v1.0.bin'))
        allowed = (root / 'unreal/NoriDesktop').resolve()

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *_):
                pass

            def do_POST(self):
                if self.path != '/render' or not hmac.compare_digest(self.headers.get('Authorization', ''), 'Bearer ' + token):
                    self.send_error(403)
                    return
                try:
                    size = int(self.headers.get('Content-Length', '0'))
                    if not 0 < size <= 16384:
                        raise ValueError('Invalid request size')
                    data = json.loads(self.rfile.read(size))
                    request, output = Path(data['request']).resolve(), Path(data['output']).resolve()
                    for path in (request, output):
                        path.relative_to(allowed)
                        if 'Speech' not in path.parts:
                            raise ValueError('Only desktop speech files are accepted')
                    render(request, output, assets, engine=engine)
                    body = b'{"ok":true}'
                    self.send_response(200)
                    self.send_header('Content-Type', 'application/json')
                    self.send_header('Content-Length', str(len(body)))
                    self.end_headers()
                    self.wfile.write(body)
                except Exception:
                    self.send_error(500, 'Local speech rendering failed')

        server.RequestHandlerClass = Handler
        config.write_text(json.dumps({'token': token, 'ready': True}), encoding='utf-8')
        server.serve_forever()
    else:
        settings = json.loads(config.read_text(encoding='utf-8'))
        body = json.dumps({'request': str(args.request.resolve()), 'output': str(args.output.resolve())}).encode()
        req = Request(f'http://127.0.0.1:{PORT}/render', data=body,
                      headers={'Authorization': 'Bearer ' + settings['token'], 'Content-Type': 'application/json'})
        with urlopen(req, timeout=115) as response:
            if json.load(response).get('ok') is not True:
                raise RuntimeError('Voice worker did not finish')


if __name__ == '__main__':
    main()
