"""HTTP contract checks: history reaches adapter intact, malformed roles do not."""
import json
import tempfile
import threading
import unittest
from pathlib import Path
from unittest.mock import patch
from urllib.request import Request, urlopen
from urllib.error import HTTPError
from http.server import ThreadingHTTPServer
import nori_model_service as service

class Adapter:
    def available(self): return True
    def models(self): return ['test']
    def generate(self, request):
        self.received=request
        return 'verified response'

class HistoryTests(unittest.TestCase):
    def test_http_history_contract(self):
        adapter=Adapter()
        with tempfile.TemporaryDirectory() as folder, patch.object(service,'ADAPTER',adapter), patch.object(service,'AUDIT_PATH',Path(folder)/'audit.jsonl'):
            server=ThreadingHTTPServer(('127.0.0.1',0),service.Handler)
            thread=threading.Thread(target=server.serve_forever,daemon=True); thread.start()
            def post(history):
                body={'model':'test','prompt':'What name did I give you?', 'history':history}
                req=Request(f'http://127.0.0.1:{server.server_port}/v1/chat',data=json.dumps(body).encode(),headers={'Content-Type':'application/json'})
                return urlopen(req,timeout=3)
            try:
                history=[{'role':'user','content':'My name is Rowan.'},{'role':'assistant','content':'Hello Rowan.'}]
                with post(history) as response:
                    self.assertEqual(json.load(response)['response'],'verified response')
                self.assertEqual(adapter.received.history,history)
                self.assertEqual(adapter.received.prompt,'What name did I give you?')
                for invalid in [None, {}, history[:1], [{'role':'system','content':'x'},history[1]], history*17]:
                    with self.subTest(invalid=invalid), self.assertRaises(HTTPError) as failure: post(invalid)
                    self.assertEqual(failure.exception.code,400)
                    self.assertEqual(json.load(failure.exception)['error'],'invalid_history')
            finally:
                server.shutdown(); server.server_close(); thread.join()

if __name__=='__main__': unittest.main()
