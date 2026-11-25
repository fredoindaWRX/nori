"""Durable first-boot checkpoints for a locally controlled enrollment service.

Checkpoints are not credentials or authority. The caller must supply trusted
checks of real installed state, and activation rechecks every requirement.
Never expose this class directly as an unauthenticated enrollment endpoint.
"""
from __future__ import annotations

import sqlite3
from contextlib import contextmanager
from pathlib import Path
from collections.abc import Callable, Mapping


STEPS = ('encrypted_storage', 'owner_profile', 'password_or_pin',
         'device_key', 'offline_recovery_key', 'audio_setup')
STATES = {'UNCLAIMED_IMAGE', 'PROVISIONING_WIZARD',
          'RESUMABLE_CHECKPOINT', 'ENROLLED_ACTIVE'}


class ProvisioningState:
    def __init__(self, path: Path, checks: Mapping[str, Callable[[], bool]]):
        if set(checks) != set(STEPS) or any(not callable(check) for check in checks.values()):
            raise ValueError('Every provisioning requirement needs a trusted verifier')
        self.checks = dict(checks)
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with self._connect() as db:
            db.execute('CREATE TABLE IF NOT EXISTS enrollment (id INTEGER PRIMARY KEY CHECK(id=1), state TEXT NOT NULL)')
            db.execute("INSERT OR IGNORE INTO enrollment VALUES (1, 'UNCLAIMED_IMAGE')")
            db.execute('CREATE TABLE IF NOT EXISTS checkpoints (step TEXT PRIMARY KEY, verified INTEGER NOT NULL CHECK(verified IN (0,1)))')
            db.execute('CREATE TABLE IF NOT EXISTS events (id INTEGER PRIMARY KEY, recorded_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, event TEXT NOT NULL, step TEXT)')
        self.path.chmod(0o600)

    @contextmanager
    def _connect(self):
        db = sqlite3.connect(self.path, timeout=10)
        try:
            db.execute('PRAGMA synchronous=FULL')
            with db:
                yield db
        finally:
            db.close()

    def _verify(self, step):
        try:
            return self.checks[step]() is True
        except Exception:
            # No exception text: adapters may include secrets in errors.
            return False

    def status(self):
        with self._connect() as db:
            state = db.execute('SELECT state FROM enrollment WHERE id=1').fetchone()[0]
            completed = {row[0] for row in db.execute('SELECT step FROM checkpoints WHERE verified=1')}
        if state not in STATES or not completed <= set(STEPS):
            raise ValueError('Invalid provisioning state')
        return {'state': state, 'checkpointed_steps': [step for step in STEPS if step in completed],
                'remaining_steps': [step for step in STEPS if step not in completed]}

    def begin(self):
        with self._connect() as db:
            db.execute('BEGIN IMMEDIATE')
            state = db.execute('SELECT state FROM enrollment WHERE id=1').fetchone()[0]
            if state == 'ENROLLED_ACTIVE':
                raise PermissionError('Existing owner requires authenticated recovery, not first boot')
            if state not in STATES:
                raise ValueError('Invalid provisioning state')
            db.execute("UPDATE enrollment SET state='PROVISIONING_WIZARD' WHERE id=1")
            db.execute("INSERT INTO events(event) VALUES ('wizard_started_or_resumed')")
        return self.status()

    def checkpoint(self, step):
        if step not in STEPS:
            raise ValueError('Unknown provisioning step')
        with self._connect() as db:
            db.execute('BEGIN IMMEDIATE')
            if db.execute('SELECT state FROM enrollment WHERE id=1').fetchone()[0] != 'PROVISIONING_WIZARD':
                raise PermissionError('Start or resume the local wizard first')
            verified = self._verify(step)
            db.execute('INSERT OR REPLACE INTO checkpoints VALUES (?, ?)', (step, int(verified)))
            db.execute('INSERT INTO events(event, step) VALUES (?, ?)',
                       ('step_verified' if verified else 'step_failed', step))
        return verified

    def interrupt(self):
        with self._connect() as db:
            db.execute('BEGIN IMMEDIATE')
            if db.execute('SELECT state FROM enrollment WHERE id=1').fetchone()[0] == 'PROVISIONING_WIZARD':
                db.execute("UPDATE enrollment SET state='RESUMABLE_CHECKPOINT' WHERE id=1")
                db.execute("INSERT INTO events(event) VALUES ('wizard_interrupted')")
        return self.status()

    def activate(self):
        with self._connect() as db:
            db.execute('BEGIN IMMEDIATE')
            if db.execute('SELECT state FROM enrollment WHERE id=1').fetchone()[0] != 'PROVISIONING_WIZARD':
                raise PermissionError('Start or resume the local wizard first')
            results = {step: self._verify(step) for step in STEPS}
            db.executemany('INSERT OR REPLACE INTO checkpoints VALUES (?, ?)',
                           [(step, int(ok)) for step, ok in results.items()])
            complete = all(results.values())
            db.execute('UPDATE enrollment SET state=? WHERE id=1',
                       ('ENROLLED_ACTIVE' if complete else 'RESUMABLE_CHECKPOINT',))
            db.execute('INSERT INTO events(event) VALUES (?)',
                       ('enrollment_verified' if complete else 'activation_failed',))
        return complete

    def workers_allowed(self):
        # Saved status alone cannot unlock workers after an incomplete restore
        # or missing volume. Real adapters must recheck the installed artifacts.
        return self.status()['state'] == 'ENROLLED_ACTIVE' and all(self._verify(step) for step in STEPS)
