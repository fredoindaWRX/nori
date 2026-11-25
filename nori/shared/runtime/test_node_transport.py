"""Actual TLS socket tests; OpenSSL generates disposable fixture identities."""
import hashlib
import http.client
import json
import os
from pathlib import Path
import shutil
import ssl
import subprocess
import tempfile
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from node_model_bridge import LocalModelBridge
from node_enrollment import EnrollmentStore
from node_transport import enrollment_server, tls_context


class TransportTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        openssl_binary = os.environ.get('NORI_OPENSSL') or shutil.which('openssl')
        if not openssl_binary:
            self.fail('OpenSSL is required for disposable TLS fixtures; set NORI_OPENSSL or add openssl to PATH')

        def openssl(*args):
            subprocess.run([openssl_binary, *args], cwd=self.root, check=True, capture_output=True)
        openssl('req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', 'ca.key', '-out', 'ca.pem', '-days', '1', '-subj', '/CN=NORI-test-CA')
        for name in ('server', 'home', 'other'):
            openssl('req', '-new', '-newkey', 'rsa:2048', '-nodes', '-keyout', name+'.key', '-out', name+'.csr', '-subj', '/CN='+name)
            (self.root/'extensions').write_text('basicConstraints=CA:FALSE\nsubjectAltName=DNS:localhost\nextendedKeyUsage=serverAuth,clientAuth\n')
            openssl('x509', '-req', '-in', name+'.csr', '-CA', 'ca.pem', '-CAkey', 'ca.key', '-CAcreateserial', '-out', name+'.pem', '-days', '1', '-extfile', 'extensions')
        self.principal = 'owner.vanguard.001'
        self.store = EnrollmentStore(self.root/'peers.db', 'household', self.principal)
        self.received = []
        received = self.received
        class ModelHandler(BaseHTTPRequestHandler):
            def log_message(self, *_): pass
            def do_POST(self):
                received.append(json.loads(self.rfile.read(int(self.headers['Content-Length']))))
                payload = json.dumps({'model':'fixture','response':'Transport fixture response'}).encode()
                self.send_response(200)
                self.send_header('Content-Length', str(len(payload)))
                self.end_headers()
                self.wfile.write(payload)
        self.backend = ThreadingHTTPServer(('127.0.0.1', 0), ModelHandler)
        self.backend_thread = threading.Thread(target=self.backend.serve_forever, daemon=True)
        self.backend_thread.start()
        context = tls_context(self.root/'server.pem', self.root/'server.key', self.root/'ca.pem', server=True)
        self.server = enrollment_server(('127.0.0.1', 0), context, self.store, LocalModelBridge(self.backend.server_port))
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.addCleanup(self.stop)

    def stop(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(5)
        self.backend.shutdown()
        self.backend.server_close()
        self.backend_thread.join(5)

    def request(self, name, path, data, headers=None):
        context = tls_context(self.root/(name+'.pem'), self.root/(name+'.key'), self.root/'ca.pem')
        connection = http.client.HTTPSConnection('localhost', self.server.server_port, context=context, timeout=5)
        try:
            request_headers = {'Content-Type': 'application/json'}
            request_headers.update(headers or {})
            connection.request('POST', path, json.dumps(data), request_headers)
            response = connection.getresponse()
            return response.status, json.loads(response.read())
        finally:
            connection.close()

    def test_verified_peer_enrolls_and_revocation_applies(self):
        der = ssl.PEM_cert_to_DER_cert((self.root/'home.pem').read_text())
        token = self.store.issue('home-node', hashlib.sha256(der).hexdigest())
        body = {'household': 'household', 'principal':self.principal,
                'node': 'home-node', 'token': token}
        self.assertEqual(self.request('other', '/v1/node/enroll', body)[0], 403)
        self.assertEqual(self.request('home', '/v1/node/enroll', body)[0], 200)
        self.assertEqual(self.request('home', '/v1/node/enroll', body)[0], 403)
        self.assertEqual(self.request('home', '/v1/node/identity', body)[0], 200)
        self.assertEqual(self.request('other', '/v1/node/identity', body)[0], 403)
        self.assertEqual(self.request('home', '/v1/node/identity', dict(body, fingerprint='a'*64))[0], 400)
        self.store.revoke('home-node')
        self.assertEqual(self.request('home', '/v1/node/identity', body)[0], 403)

    def test_missing_client_certificate_rejected(self):
        context = ssl.create_default_context(cafile=str(self.root/'ca.pem'))
        connection = http.client.HTTPSConnection('localhost', self.server.server_port, context=context, timeout=5)
        try:
            with self.assertRaises((ssl.SSLError, ConnectionError)):
                connection.request('POST', '/v1/node/identity', '{}')
                connection.getresponse()
        finally:
            connection.close()

    def test_chat_routes_only_after_enrollment(self):
        der = ssl.PEM_cert_to_DER_cert((self.root/'home.pem').read_text())
        token = self.store.issue('home-node', hashlib.sha256(der).hexdigest())
        body = {'household':'household', 'principal':self.principal, 'node':'home-node', 'request':{
            'model':'fixture','prompt':'Remember my name?',
            'history':[{'role':'user','content':'Rowan'},{'role':'assistant','content':'Hello Rowan'}]}}
        self.assertEqual(self.request('home', '/v1/node/chat', body)[0], 403)
        self.assertEqual(self.received, [])
        self.assertEqual(self.request('home', '/v1/node/enroll', dict(body, token=token))[0], 200)
        status, result = self.request('home', '/v1/node/chat', body)
        self.assertEqual(status, 200)
        self.assertEqual(result['response'], 'Transport fixture response')
        self.assertEqual(self.received[0]['history'], body['request']['history'])
        self.assertEqual(self.request('other', '/v1/node/chat', body)[0], 403)
        self.store.revoke('home-node')
        self.assertEqual(self.request('home', '/v1/node/chat', body)[0], 403)
        self.assertEqual(len(self.received), 1)

    def test_client_rejects_wrong_server_identity_and_authority(self):
        for host, context in (
            ('127.0.0.1', tls_context(self.root/'home.pem', self.root/'home.key', self.root/'ca.pem')),
            ('localhost', ssl.create_default_context()),
        ):
            connection = http.client.HTTPSConnection(host, self.server.server_port, context=context, timeout=5)
            try:
                with self.assertRaises(ssl.SSLCertVerificationError):
                    connection.request('POST', '/v1/node/identity', '{}')
            finally:
                connection.close()

    def test_browser_origin_and_non_json_are_rejected_before_enrollment(self):
        body = {'household':'household', 'principal':self.principal,
                'node':'home-node', 'token':'unused'}
        self.assertEqual(self.request('home', '/v1/node/enroll', body,
                                     {'Origin':'https://example.invalid'})[0], 403)
        self.assertEqual(self.request('home', '/v1/node/enroll', body,
                                     {'Content-Type':'text/plain'})[0], 400)


if __name__ == '__main__':
    unittest.main()
