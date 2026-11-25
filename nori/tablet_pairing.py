"""PC-issued, short-lived, single-use tablet pairing codes."""
import hmac
import json
import os
import secrets
import time
from threading import Lock

_lock = Lock()


def issue(path, lifetime_seconds=1800):
    """Create one eight-digit pairing code; only the code itself is returned."""
    if type(lifetime_seconds) is not int or not 60 <= lifetime_seconds <= 3600:
        raise ValueError('Pairing lifetime must be between one minute and one hour')
    path = path.resolve()
    state = {
        'code': f'{secrets.randbelow(100_000_000):08d}',
        'expires': time.time() + lifetime_seconds,
        'attempts': 0,
    }
    with _lock:
        path.parent.mkdir(parents=True, exist_ok=True)
        temporary = path.with_suffix(path.suffix + '.tmp')
        temporary.write_text(json.dumps(state), encoding='utf-8')
        os.replace(temporary, path)
    return state['code']


def redeem(path, code):
    with _lock:
        if not path.is_file():
            return False
        state = json.loads(path.read_text())
        if time.time() > state['expires'] or state['attempts'] >= 5:
            path.unlink()
            return False
        state['attempts'] += 1
        if hmac.compare_digest(str(state['code']), code):
            path.unlink()
            return True
        path.write_text(json.dumps(state))
        return False
