"""Native Core inference contract; no legacy API translation or fallback.

This client generates text proposals only. Knight permissions and action
validation remain the responsibility of Core, not the model or this client.
"""
import http.client
import json
import re
import threading
from urllib.parse import urlsplit


class NativeInferenceError(RuntimeError):
    pass


class NativeInferenceCancelled(NativeInferenceError):
    pass


def _response_json(text):
    def unique(pairs):
        result = {}
        for key, value in pairs:
            if key in result:
                raise ValueError('Duplicate native response key')
            result[key] = value
        return result
    def invalid_constant(value):
        raise ValueError('Nonfinite native response value')
    return json.loads(text, object_pairs_hook=unique, parse_constant=invalid_constant)


class NativeInferenceClient:
    def __init__(self, endpoint, api_key, model_id, timeout=125):
        address = urlsplit(endpoint)
        if (address.scheme != 'http' or address.hostname != '127.0.0.1'
                or address.username or address.password or address.path not in ('', '/')
                or address.query or address.fragment or not address.port):
            raise ValueError('explicit IPv4 loopback native endpoint required')
        if not re.fullmatch(r'[A-Za-z0-9_-]{32,128}', api_key):
            raise ValueError('private native runtime credential required')
        if not re.fullmatch(r'[A-Za-z0-9._:-]{1,128}', model_id):
            raise ValueError('qualified native model identifier required')
        if isinstance(timeout, bool) or not isinstance(timeout, (int, float)) or not 0 < timeout <= 125:
            raise ValueError('bounded native timeout required')
        self.port, self._key, self.model_id, self.timeout = address.port, api_key, model_id, timeout
        self.endpoint = f'http://127.0.0.1:{self.port}'

    def _request(self, path, body=None):
        connection = http.client.HTTPConnection('127.0.0.1', self.port, timeout=self.timeout)
        try:
            encoded = None if body is None else json.dumps(body, ensure_ascii=False, allow_nan=False).encode('utf-8')
            connection.request('GET' if body is None else 'POST', path, body=encoded,
                               headers={'Authorization': 'Bearer ' + self._key, 'Content-Type': 'application/json'})
            response = connection.getresponse()
            data = response.read(1048577)
            if len(data) > 1048576:
                raise NativeInferenceError('native response exceeded bounded contract')
            # Never forward a server error body: it may contain private prompts.
            if response.status != 200:
                raise NativeInferenceError(f'native inference unavailable ({response.status}); no fallback')
            result = _response_json(data.decode('utf-8'))
            if not isinstance(result, dict):
                raise NativeInferenceError('invalid native response contract')
            return result
        except (OSError, http.client.HTTPException, UnicodeError, ValueError) as error:
            raise NativeInferenceError('native transport or response failure; no fallback') from error
        finally:
            connection.close()

    def health(self):
        body = self._request('/health')
        if body.get('ready') is not True or body.get('backend') != 'norama-independent' or body.get('model_id') != self.model_id:
            raise NativeInferenceError('qualified native model is not ready')
        return {'ready': True, 'backend': 'norama-independent', 'model_id': self.model_id}

    def models(self):
        result = self._request('/v1/models')
        models = result.get('models')
        if not isinstance(models,list) or len(models) != 1:
            raise NativeInferenceError('invalid native model inventory')
        model = models[0]
        if (not isinstance(model,dict) or model.get('id') != self.model_id
                or model.get('backend') != 'norama-independent'
                or model.get('provenance') not in {'imported','scratch-trained-experimental'}
                or model.get('assistant_qualified') is not False):
            raise NativeInferenceError('invalid native model inventory identity')
        return {'models': [{key:model[key] for key in ('id','backend','provenance','assistant_qualified')}]}

    def preflight(self, model_id):
        """Inspect only the current resident model; never load or download."""
        if not isinstance(model_id,str) or not re.fullmatch(r'[A-Za-z0-9._:-]{1,128}',model_id):
            raise ValueError('invalid native preflight model')
        if model_id != self.model_id:
            return {'model_id':model_id,'status':'unsupported','ready':False,
                    'reason':'native_multi_model_loading_not_implemented',
                    'inspection_scope':'resident_model_only','model_changed':False}
        health = self.health()
        inventory = self.models()['models'][0]
        return {**health,'status':'ready','provenance':inventory['provenance'],
                'assistant_qualified':False,'task_execution_qualified':False,
                'inspection_scope':'resident_model_only','model_changed':False}

    def bound_plan(self, allowed_actions, required_calls, *, required_dependencies=()):
        """Fetch an exact fixed-call proposal, not tool execution authority."""
        from pathlib import Path
        import sys
        contracts = str(Path(__file__).resolve().parents[2] / 'nori')
        if contracts not in sys.path:
            sys.path.append(contracts)
        from task_plan import canonical, compile_bound_proposal
        expected = compile_bound_proposal(allowed_actions, required_calls,
                                          required_dependencies=required_dependencies)
        result = self._request('/v1/bound-plan', {
            'allowed_actions': sorted(allowed_actions), 'required_calls': required_calls,
            'required_dependencies': required_dependencies})
        # Recompute locally: remote hashes/authorization flags are not trusted
        # simply because the transport carried an authenticated response.
        if canonical(result) != canonical(expected):
            raise NativeInferenceError('native bound-plan response does not match Core contract')
        return result

    def prepare_bound_review(self, task, allowed_actions, required_calls, *, required_dependencies=()):
        """Bind an authenticated fixed proposal to review; never execute it."""
        # Validate the task before making even a proposal request.
        if type(task) is not str or not task.strip() or len(task.encode('utf-8')) > 32000:
            raise ValueError('Bounded original review task required')
        proposal = self.bound_plan(allowed_actions, required_calls,
                                   required_dependencies=required_dependencies)
        from task_plan import canonical
        from task_review import review_contract
        review = review_contract(task, canonical(proposal['plan']), allowed_actions,
                                 required_calls, required_dependencies=required_dependencies)
        return {'proposal': proposal, 'review_contract': review,
                'execution_authorized': False, 'executed_tools': []}

    def validate_bound_review(self, review_text, task, allowed_actions, required_calls,
                              *, required_dependencies=()):
        """Validate a verdict against current inputs, never caller-supplied hashes."""
        from pathlib import Path
        import sys
        contracts = str(Path(__file__).resolve().parents[2] / 'nori')
        if contracts not in sys.path:
            sys.path.append(contracts)
        from task_plan import canonical, compile_bound_proposal
        from task_review import validate_review
        proposal = compile_bound_proposal(allowed_actions, required_calls,
                                          required_dependencies=required_dependencies)
        return validate_review(review_text, task, canonical(proposal['plan']),
                               allowed_actions, required_calls,
                               required_dependencies=required_dependencies)

    def _cancellable_request(self, body, cancel_event):
        if cancel_event.is_set():
            raise NativeInferenceCancelled('native inference cancelled before dispatch')
        connection = http.client.HTTPConnection('127.0.0.1', self.port, timeout=self.timeout)
        finished = threading.Event()
        cancellation_sent = threading.Event()
        request_id = None
        watcher = None
        try:
            body = {**body, 'stream': True}
            connection.request('POST', '/v1/chat', body=json.dumps(body, ensure_ascii=False).encode('utf-8'),
                               headers={'Authorization': 'Bearer ' + self._key, 'Content-Type': 'application/json'})
            response = connection.getresponse()
            identifier = response.getheader('X-Nori-Request-ID', '')
            if response.status != 200 or not identifier.isdecimal() or not 1 <= int(identifier) <= 0xFFFFFFFF:
                raise NativeInferenceError('invalid native cancellable response identity')
            request_id = int(identifier)
            def watch():
                while not finished.wait(0.02):
                    if cancel_event.is_set():
                        try:
                            bounded = NativeInferenceClient(self.endpoint, self._key, self.model_id, timeout=3)
                            bounded._request('/v1/cancel', {'request_id': request_id})
                            cancellation_sent.set()
                        except NativeInferenceError:
                            pass  # Stream close below remains request-owned cleanup.
                        return
            watcher = threading.Thread(target=watch, name='native-core-cancel', daemon=True)
            watcher.start()
            text, stats, lines, total, tokens = [], None, [], 0, 0
            while True:
                line = response.readline(262145)
                total += len(line)
                if len(line) > 262144 or total > 1048576:
                    raise NativeInferenceError('native stream exceeded bounded contract')
                if cancel_event.is_set():
                    raise NativeInferenceCancelled('native inference cancelled')
                if not line:
                    raise NativeInferenceError('native stream ended before completion')
                if line.strip():
                    lines.append(line.decode('utf-8').rstrip('\r\n'))
                    continue
                event = next((item[6:].strip() for item in lines if item.startswith('event:')), '')
                data = '\n'.join(item[5:].lstrip() for item in lines if item.startswith('data:'))
                comment_only = all(item.startswith(':') for item in lines)
                lines = []
                if not event and not data and comment_only:
                    continue  # SSE heartbeat comments are not JSON records.
                if data == '[DONE]':
                    if stats is None: raise NativeInferenceError('native stream missing metrics')
                    return {'model_id': self.model_id, 'text': ''.join(text), 'metrics': stats}
                value = _response_json(data)
                if not isinstance(value, dict): raise NativeInferenceError('invalid native stream record')
                if event == 'token':
                    tokens += 1
                    if not isinstance(value.get('text'), str) or tokens > body['max_tokens']:
                        raise NativeInferenceError('invalid native token contract')
                    text.append(value['text'])
                elif event == 'metrics':
                    if value.get('request_id') != request_id:
                        raise NativeInferenceError('native stream ownership mismatch')
                    if value.get('state') != 'started': stats = value
                else:
                    raise NativeInferenceError('native stream failed; no fallback')
        except (OSError, http.client.HTTPException, UnicodeError, ValueError) as error:
            if cancel_event.is_set(): raise NativeInferenceCancelled('native inference cancelled') from error
            raise NativeInferenceError('native stream transport failure; no fallback') from error
        finally:
            finished.set()
            connection.close()
            if watcher is not None:
                watcher.join(4)
                if watcher.is_alive(): raise NativeInferenceError('native cancellation watcher did not stop')
            if cancel_event.is_set() and request_id is not None and not cancellation_sent.is_set():
                bounded = NativeInferenceClient(self.endpoint, self._key, self.model_id, timeout=3)
                bounded._request('/v1/cancel', {'request_id': request_id})

    def generate(self, messages, max_tokens=240, *, model_id=None, cancel_event=None):
        if model_id is not None and model_id != self.model_id:
            raise ValueError('unqualified model; no model substitution')
        if type(max_tokens) is not int or not 1 <= max_tokens <= 2048:
            raise ValueError('native output limit must be 1..2048')
        if not isinstance(messages, list) or not 1 <= len(messages) <= 64:
            raise ValueError('native text messages required')
        total = 0
        for message in messages:
            if (not isinstance(message, dict) or set(message) != {'role', 'content'}
                    or message['role'] not in {'system', 'user', 'assistant'} or not isinstance(message['content'], str)):
                raise ValueError('only native role/content text messages supported')
            size = len(message['content'].encode('utf-8'))
            if size > 65536:
                raise ValueError('native message too large')
            total += size
        if total > 245760:
            raise ValueError('native conversation too large')
        body = {'model_id': self.model_id, 'messages': messages, 'max_tokens': max_tokens, 'stream': False}
        result = self._request('/v1/chat', body) if cancel_event is None else self._cancellable_request(body, cancel_event)
        if result.get('model_id') != self.model_id or not isinstance(result.get('text'), str) or not isinstance(result.get('metrics'), dict):
            raise NativeInferenceError('native generation identity or result contract mismatch')
        stats = result['metrics']
        if (stats.get('finish_reason') not in {'stop', 'length'}
                or type(stats.get('output_tokens')) is not int or not 0 <= stats['output_tokens'] <= max_tokens
                or type(stats.get('prompt_tokens')) is not int or not 1 <= stats['prompt_tokens'] <= 2048):
            raise NativeInferenceError('native generation metrics contract mismatch')
        return {'model_id': self.model_id, 'text': result['text'], 'metrics': result['metrics'],
                'backend': 'norama-independent', 'fallback': False}
