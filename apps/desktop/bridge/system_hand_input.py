"""Loopback-only live hand input for Windows.  Nori supplies normalised hand
coordinates; this service owns the actual mouse so the browser never gets OS
automation privileges.  Pinch is a held button, not a one-shot gesture."""
import json
import os
import math
import hmac
from threading import Lock, Event, Thread
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import pyautogui

pyautogui.PAUSE = 0
pyautogui.FAILSAFE = True
down = False
input_lock = Lock()
last_input = 0.0
HELD_TIMEOUT = 1.0
origin = os.getenv('NORI_DESKTOP_ORIGIN', 'http://127.0.0.1:5188')
control_key = os.getenv('NORI_HAND_INPUT_KEY', '')

def authorized(headers):
    return len(control_key) >= 32 and hmac.compare_digest(headers.get('Authorization', ''), 'Bearer ' + control_key)

def desktop_bounds():
    if os.name == 'nt':
        import ctypes
        metrics = ctypes.windll.user32.GetSystemMetrics
        return tuple(metrics(index) for index in (76, 77, 78, 79))
    width, height = pyautogui.size()
    return 0, 0, width, height

def map_position(x, y, bounds):
    left, top, width, height = bounds
    if width < 1 or height < 1:
        raise ValueError('desktop bounds')
    return left + round(x * (width - 1)), top + round(y * (height - 1))

def validate_input(body):
    if not isinstance(body, dict) or set(body) != {'x', 'y', 'pinch'}:
        raise ValueError('input fields')
    if type(body['pinch']) is not bool:
        raise ValueError('pinch must be boolean')
    for name in ('x', 'y'):
        value = body[name]
        if type(value) not in (int, float) or not math.isfinite(value) or not 0 <= value <= 1:
            raise ValueError('coordinates')
    return float(body['x']), float(body['y']), body['pinch']

def apply_input(x, y, pinch):
    global down, last_input
    # ThreadingHTTPServer may process gesture updates concurrently. Coordinate
    # movement and button transition are one serialized operation.
    with input_lock:
        px, py = map_position(x, y, desktop_bounds())
        pyautogui.moveTo(px, py, _pause=False)
        if pinch and not down:
            pyautogui.mouseDown(_pause=False)
            down=True
        elif not pinch and down:
            pyautogui.mouseUp(_pause=False)
            down=False
        last_input = time.monotonic()

def release_stale_input(now=None):
    global down
    with input_lock:
        current = time.monotonic() if now is None else now
        if down and current - last_input >= HELD_TIMEOUT:
            pyautogui.mouseUp(_pause=False)
            down = False

def release_held_input():
    global down
    with input_lock:
        if down:
            pyautogui.mouseUp(_pause=False)
            down = False

def watch_input(stop):
    while not stop.wait(0.1):
        try:
            release_stale_input()
        except Exception:
            pass # Adapter may reject an action; retain held state for retry.

class Handler(BaseHTTPRequestHandler):
    def log_message(self, *_): pass
    def _reply(self, code=200):
        self.send_response(code); self.send_header('Access-Control-Allow-Origin', origin)
        self.send_header('Access-Control-Allow-Methods','POST, OPTIONS'); self.end_headers()
    def do_OPTIONS(self):
        if self.headers.get('Origin') != origin: self._reply(403); return
        self._reply()
    def do_POST(self):
        global down
        if not authorized(self.headers): self._reply(401); return
        if self.headers.get('Origin') != origin: self._reply(403); return
        if self.path != '/input': self._reply(404); return
        try:
            n=int(self.headers.get('Content-Length','0'))
            if not 0 < n <= 2048: raise ValueError('request size')
            body=json.loads(self.rfile.read(n))
            x,y,pinch=validate_input(body)
            apply_input(x, y, pinch)
            self._reply()
        except Exception: self._reply(400)

if __name__ == '__main__':
    if len(control_key) < 32:
        raise ValueError('Private hand input key required; no unauthenticated server started')
    server = ThreadingHTTPServer(('127.0.0.1',int(os.getenv('NORI_HAND_INPUT_PORT','9393'))),Handler)
    stop = Event()
    watchdog = Thread(target=watch_input, args=(stop,), daemon=True)
    watchdog.start()
    try:
        server.serve_forever()
    finally:
        stop.set()
        watchdog.join(timeout=1)
        server.server_close()
        release_held_input()
