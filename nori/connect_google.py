"""Owner-run Google Desktop OAuth sign-in with PKCE and loopback callback."""
import base64
import hashlib
import hmac
from http.server import BaseHTTPRequestHandler, HTTPServer
import secrets
import time
from urllib.parse import parse_qs, urlencode, urlsplit
import webbrowser

from google_connection import client_config, request_json, save_token, SCOPES, TOKEN_URL
from security.hard_floor import assert_network_allowed


def callback_code(path, expected_state):
    parsed=urlsplit(path)
    query=parse_qs(parsed.query)
    if parsed.path!='/callback' or set(query)-{'state','code','scope','authuser','prompt','error'}:
        raise ValueError('Unexpected OAuth callback')
    values=query.get('state',[])
    if len(values)!=1 or not hmac.compare_digest(values[0],expected_state): raise ValueError('OAuth state mismatch')
    if 'error' in query: raise ValueError('Google sign-in was declined')
    codes=query.get('code',[])
    if len(codes)!=1 or not 1<=len(codes[0])<=4096: raise ValueError('Missing Google authorization code')
    return codes[0]


def connect():
    client=client_config()
    # Discover a blocked token exchange before asking the owner to sign in.
    assert_network_allowed(TOKEN_URL)
    verifier=secrets.token_urlsafe(64)
    challenge=base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).decode().rstrip('=')
    state=secrets.token_urlsafe(32)
    received=[]
    class Callback(BaseHTTPRequestHandler):
        def log_message(self,*args): pass
        def do_GET(self):
            try:
                code=callback_code(self.path,state)
                received.append(code)
                response=b'Google sign-in received. Return to NORI to check connection status.'
                self.send_response(200)
            except ValueError:
                response=b'Invalid or declined sign-in. Return to NORI.'
                self.send_response(400)
            self.send_header('Content-Type','text/plain; charset=utf-8')
            self.send_header('Content-Length',str(len(response)))
            self.send_header('Cache-Control','no-store')
            self.end_headers();self.wfile.write(response)
    with HTTPServer(('127.0.0.1',0),Callback) as server:
        server.timeout=1
        redirect='http://127.0.0.1:'+str(server.server_port)+'/callback'
        url='https://accounts.google.com/o/oauth2/v2/auth?'+urlencode({
            'client_id':client['client_id'],'redirect_uri':redirect,'response_type':'code',
            'scope':' '.join(SCOPES),'state':state,'code_challenge':challenge,'code_challenge_method':'S256',
            'access_type':'offline','prompt':'consent'})
        if not webbrowser.open(url): raise RuntimeError('Could not open the system browser')
        deadline=time.monotonic()+180
        while not received and time.monotonic()<deadline: server.handle_request()
        if not received: raise RuntimeError('Google sign-in timed out')
    token=request_json(TOKEN_URL,form={'code':received[0],'client_id':client['client_id'],
        'client_secret':client.get('client_secret',''),'redirect_uri':redirect,'grant_type':'authorization_code','code_verifier':verifier})
    if not isinstance(token.get('access_token'),str) or not isinstance(token.get('refresh_token'),str):
        raise ValueError('Google did not return the required tokens')
    if not set(SCOPES).issubset(set(token.get('scope','').split())):
        raise ValueError('Required read permissions were not granted')
    token['expires_at']=time.time()+int(token.get('expires_in',3600))
    save_token(token)
    print('Google sign-in saved with Windows protection. Run a Gmail or Calendar read to verify account access.')


if __name__=='__main__':
    try: connect()
    except Exception as error:
        # No OAuth authorization codes or provider response bodies in output.
        print('Google connection could not finish: '+str(error))
        raise SystemExit(1)
