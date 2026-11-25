"""NORI mutual-TLS enrollment endpoint; owner invitation issuance stays local."""
import hashlib
import json
import ssl
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer


def tls_context(certificate, key, authority, *, server=False):
    context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER if server else ssl.PROTOCOL_TLS_CLIENT)
    context.minimum_version = ssl.TLSVersion.TLSv1_2
    context.load_verify_locations(cafile=str(authority))
    context.load_cert_chain(str(certificate), str(key))
    context.verify_mode = ssl.CERT_REQUIRED
    if not server:
        context.check_hostname = True
    return context


def enrollment_server(address, context, store, model_service=None):
    if context.verify_mode != ssl.CERT_REQUIRED:
        raise ValueError('Mutual TLS requires verified client certificates')

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *_):
            pass  # Never log pairing tokens or request bodies.

        def setup(self):
            super().setup()
            self.connection.settimeout(10)

        def reply(self, code, value):
            body = json.dumps(value).encode()
            self.send_response(code)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Content-Length', str(len(body)))
            self.send_header('Cache-Control', 'no-store')
            self.send_header('X-Content-Type-Options', 'nosniff')
            self.send_header('X-Frame-Options', 'DENY')
            self.end_headers()
            self.wfile.write(body)

        def do_POST(self):
            if self.path not in ('/v1/node/enroll', '/v1/node/identity', '/v1/node/chat'):
                return self.reply(404, {'error': 'not_found'})
            try:
                # Nexus is a node protocol, not a browser endpoint. Reject
                # browser-originated calls even when a browser has access to a
                # client certificate, and accept one unambiguous JSON body.
                if self.headers.get('Origin') or self.headers.get('Sec-Fetch-Site') not in (None, 'none', 'same-origin'):
                    return self.reply(403, {'error': 'node_client_required'})
                if self.headers.get_content_type() != 'application/json':
                    raise ValueError('JSON required')
                lengths = self.headers.get_all('Content-Length', [])
                if self.headers.get('Transfer-Encoding') or len(lengths) != 1 or not lengths[0].isdigit():
                    raise ValueError('Invalid framing')
                size = int(lengths[0])
                if not 0 < size <= (60000 if self.path == '/v1/node/chat' else 4096):
                    raise ValueError('Invalid size')
                body = json.loads(self.rfile.read(size))
                if not isinstance(body, dict):
                    raise ValueError('Invalid request')
                household, principal, node = body['household'], body['principal'], body['node']
                # TLS proves possession of the private key. Ignore no JSON substitute.
                if 'fingerprint' in body:
                    raise ValueError('Fingerprint must come from TLS')
                certificate = self.connection.getpeercert(binary_form=True)
                if not certificate:
                    return self.reply(403, {'error': 'certificate_required'})
                fingerprint = hashlib.sha256(certificate).hexdigest()
                if self.path == '/v1/node/enroll':
                    ok = store.redeem(household, principal, node, fingerprint, body['token'])
                else:
                    ok = store.trusted(household, principal, node, fingerprint)
                if self.path == '/v1/node/chat' and ok:
                    if model_service is None:
                        return self.reply(503, {'error': 'model_service_unconfigured'})
                    try:
                        result = model_service.chat(body['request'])
                    except ValueError:
                        return self.reply(400, {'error': 'invalid_chat'})
                    except Exception:
                        return self.reply(502, {'error': 'model_service_unavailable'})
                    return self.reply(200, result)
                return self.reply(200 if ok else 403, {'trusted': ok})
            except (ValueError, KeyError, TypeError):
                return self.reply(400, {'error': 'invalid_request'})

    class Server(ThreadingHTTPServer):
        daemon_threads = True

        def get_request(self):
            connection, address = super().get_request()
            connection.settimeout(5)
            try:
                return context.wrap_socket(connection, server_side=True), address
            except Exception:
                connection.close()
                raise

    return Server(address, Handler)
