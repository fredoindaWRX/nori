import http.client
import json
from pathlib import Path
import sys
import threading
import unittest
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from norllama import RuntimeServer
from core_client import NativeInferenceClient, NativeInferenceError
from unittest.mock import patch


class BoundPlanHttpTests(unittest.TestCase):
    def test_authenticated_contract_never_requests_model_or_authorizes_execution(self):
        class Client:
            def request(self, *args):
                raise AssertionError('Fixed plan must not invoke inference')
        key = 'fixture-only-bound-plan-key-123456789'
        server = RuntimeServer(('127.0.0.1', 0), Client(), key, 'fixture')
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        def call(value, authorization=key):
            connection = http.client.HTTPConnection('127.0.0.1', server.server_port, timeout=3)
            try:
                connection.request('POST', '/v1/bound-plan', json.dumps(value),
                    {'Content-Type': 'application/json', 'Authorization': 'Bearer ' + authorization})
                response = connection.getresponse()
                return response.status, json.loads(response.read())
            finally:
                connection.close()
        try:
            contract = {'allowed_actions': ['read_file'],
                        'required_calls': [{'action': 'read_file', 'path': 'notes.txt'}]}
            self.assertEqual(call(contract, 'wrong')[0], 401)
            status, result = call(contract)
            self.assertEqual(status, 200)
            self.assertFalse(result['model_used'])
            self.assertFalse(result['execution_authorized'])
            self.assertEqual(result['executed_tools'], [])
            self.assertEqual(result['plan']['steps'][0]['call'], contract['required_calls'][0])
            client = NativeInferenceClient(f'http://127.0.0.1:{server.server_port}', key, 'fixture', timeout=3)
            checked = client.bound_plan(contract['allowed_actions'], contract['required_calls'])
            self.assertEqual(checked, result)
            prepared = client.prepare_bound_review('Read notes.txt', contract['allowed_actions'],
                                                   contract['required_calls'])
            self.assertEqual(prepared['review_contract']['binding']['proposal_sha256'],
                             result['proposal_sha256'])
            self.assertFalse(prepared['execution_authorized'])
            self.assertEqual(prepared['executed_tools'], [])
            verdict = json.dumps({'binding_sha256': prepared['review_contract']['binding_sha256'],
                'decision': 'accept', 'issues': [], 'reason': 'Fixture verdict; no tools executed.'})
            validated = client.validate_bound_review(verdict, 'Read notes.txt',
                contract['allowed_actions'], contract['required_calls'])
            self.assertEqual(validated['status'], 'review_accepted')
            self.assertFalse(validated['execution_authorized'])
            self.assertEqual(validated['executed_tools'], [])
            with self.assertRaises(ValueError):
                client.validate_bound_review(verdict, 'Read a different file',
                    contract['allowed_actions'], contract['required_calls'])
            with self.assertRaises(ValueError):
                client.validate_bound_review(verdict, 'Read notes.txt', contract['allowed_actions'],
                    [{'action': 'read_file', 'path': 'other.txt'}])
            changed = client.prepare_bound_review('Inspect notes.txt for a title',
                contract['allowed_actions'], contract['required_calls'])
            self.assertNotEqual(prepared['review_contract']['binding_sha256'],
                                changed['review_contract']['binding_sha256'])
            with patch.object(client, '_request', side_effect=AssertionError('No request for invalid task')):
                with self.assertRaises(ValueError):
                    client.prepare_bound_review('', contract['allowed_actions'], contract['required_calls'])
            for change in ({'execution_authorized': True}, {'proposal_sha256': 'invented'},
                           {'model_used': True}, {'executed_tools': ['read_file']},
                           {'execution_authorized': 0}, {'model_used': 0}):
                with patch.object(client, '_request', return_value={**result, **change}), \
                     self.assertRaises(NativeInferenceError):
                    client.bound_plan(contract['allowed_actions'], contract['required_calls'])
            self.assertEqual(call({**contract, 'execution_authorized': True})[0], 422)
            self.assertEqual(call({'allowed_actions': ['write_file'], 'required_calls': [
                {'action': 'write_file', 'path': 'notes.txt'}]})[0], 422)
        finally:
            server.shutdown(); server.server_close(); thread.join(timeout=3)


if __name__ == '__main__':
    unittest.main()
