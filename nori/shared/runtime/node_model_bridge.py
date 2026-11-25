"""Route enrolled node chat to this machine's NORI-native model service."""
import json
from urllib.request import Request, build_opener, ProxyHandler, HTTPRedirectHandler


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, *_):
        return None


class LocalModelBridge:
    def __init__(self, port=9391):
        if type(port) is not int or not 1 <= port <= 65535:
            raise ValueError('Invalid local service port')
        self.url = f'http://127.0.0.1:{port}/v1/chat'
        self.http = build_opener(ProxyHandler({}), NoRedirect())

    def chat(self, request):
        if not isinstance(request, dict) or set(request) - {'model', 'prompt', 'history', 'max_tokens'}:
            raise ValueError('Invalid chat fields')
        if not isinstance(request.get('model'), str) or not request['model'].strip():
            raise ValueError('Model is required')
        if not isinstance(request.get('prompt'), str) or not request['prompt'].strip():
            raise ValueError('Prompt is required')
        tokens = request.get('max_tokens', 512)
        if type(tokens) is not int or not 1 <= tokens <= 4096:
            raise ValueError('Invalid token limit')
        body = json.dumps(dict(request, max_tokens=tokens)).encode()
        if len(body) > 60000:
            raise ValueError('Request too large')
        query = Request(self.url, data=body, headers={'Content-Type': 'application/json'})
        with self.http.open(query, timeout=120) as response:
            raw = response.read(1048577)
        if len(raw) > 1048576:
            raise RuntimeError('Model response too large')
        result = json.loads(raw)
        if not isinstance(result, dict) or not isinstance(result.get('response'), str):
            raise RuntimeError('Invalid model response')
        return {'model': result.get('model', request['model']), 'response': result['response']}
