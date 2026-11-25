"""NORI household enrollment persistence, independent of transport.

The caller must authenticate the owner before issuing/revoking invitations and
verify the peer certificate before passing its SHA-256 fingerprint to redeem.
This module does not provide TLS or make self-reported fingerprints trustworthy.
"""
import hashlib
import re
import secrets
import sqlite3
import time
from pathlib import Path


class EnrollmentStore:
    def __init__(self, path, household, principal, clock=time.time):
        if not isinstance(household, str) or not re.fullmatch(r'[A-Za-z0-9_-]{1,128}', household):
            raise ValueError('Invalid household identity')
        if not isinstance(principal, str) or not re.fullmatch(r'[a-z0-9][a-z0-9._-]{2,63}', principal):
            raise ValueError('Invalid operator principal')
        self.path = Path(path)
        self.household = household
        self.principal = principal
        self.clock = clock
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with self.connect() as db:
            db.executescript('''
                CREATE TABLE IF NOT EXISTS identity (singleton INTEGER PRIMARY KEY CHECK(singleton=1), household TEXT NOT NULL, principal TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS invitations (digest TEXT PRIMARY KEY, node TEXT NOT NULL, fingerprint TEXT NOT NULL, expires REAL NOT NULL, used INTEGER NOT NULL DEFAULT 0);
                CREATE TABLE IF NOT EXISTS peers (node TEXT PRIMARY KEY, fingerprint TEXT NOT NULL UNIQUE, enrolled REAL NOT NULL, revoked INTEGER NOT NULL DEFAULT 0);
                CREATE TABLE IF NOT EXISTS events (id INTEGER PRIMARY KEY, kind TEXT NOT NULL, node TEXT NOT NULL, principal TEXT NOT NULL, time REAL NOT NULL);
            ''')
            identity = db.execute('SELECT household,principal FROM identity').fetchone()
            if identity is None:
                db.execute('INSERT INTO identity VALUES (1,?,?)', (household, principal))
            elif identity != (household, principal):
                raise ValueError('Store belongs to a different household or operator')

    def connect(self):
        db = sqlite3.connect(self.path, timeout=10)
        db.execute('PRAGMA synchronous=FULL')
        return db

    @staticmethod
    def validate(node, fingerprint):
        if not isinstance(node, str) or not re.fullmatch(r'[A-Za-z0-9_-]{1,128}', node):
            raise ValueError('Invalid node identity')
        if not isinstance(fingerprint, str) or not re.fullmatch(r'[0-9a-f]{64}', fingerprint):
            raise ValueError('Expected lowercase SHA-256 certificate fingerprint')

    def issue(self, node, fingerprint, ttl=300):
        self.validate(node, fingerprint)
        if isinstance(ttl, bool) or not isinstance(ttl, int) or not 1 <= ttl <= 600:
            raise ValueError('Invitation lifetime must be 1..600 seconds')
        token = secrets.token_urlsafe(32)
        with self.connect() as db:
            db.execute('BEGIN IMMEDIATE')
            db.execute('UPDATE invitations SET used=1 WHERE node=?', (node,))
            db.execute('INSERT INTO invitations VALUES (?,?,?,?,0)',
                       (hashlib.sha256(token.encode()).hexdigest(), node, fingerprint, self.clock() + ttl))
            db.execute('INSERT INTO events(kind,node,principal,time) VALUES (?,?,?,?)',
                       ('invitation_issued', node, self.principal, self.clock()))
        return token

    def redeem(self, household, principal, node, fingerprint, token):
        self.validate(node, fingerprint)
        if (household != self.household or principal != self.principal
                or not isinstance(token, str) or len(token) > 128):
            return False
        digest = hashlib.sha256(token.encode()).hexdigest()
        with self.connect() as db:
            db.execute('BEGIN IMMEDIATE')
            row = db.execute('SELECT node,fingerprint,expires,used FROM invitations WHERE digest=?', (digest,)).fetchone()
            if not row or row[0] != node or row[1] != fingerprint or row[2] <= self.clock() or row[3]:
                return False
            # A different node cannot steal an already enrolled certificate.
            existing = db.execute('SELECT node FROM peers WHERE fingerprint=?', (fingerprint,)).fetchone()
            if existing and existing[0] != node:
                return False
            db.execute('INSERT INTO peers VALUES (?,?,?,0) ON CONFLICT(node) DO UPDATE SET fingerprint=excluded.fingerprint,enrolled=excluded.enrolled,revoked=0',
                       (node, fingerprint, self.clock()))
            db.execute('UPDATE invitations SET used=1 WHERE digest=?', (digest,))
            db.execute('INSERT INTO events(kind,node,principal,time) VALUES (?,?,?,?)',
                       ('node_enrolled', node, self.principal, self.clock()))
        return True

    def trusted(self, household, principal, node, verified_fingerprint):
        self.validate(node, verified_fingerprint)
        if household != self.household or principal != self.principal:
            return False
        with self.connect() as db:
            return db.execute('SELECT 1 FROM peers WHERE node=? AND fingerprint=? AND revoked=0',
                              (node, verified_fingerprint)).fetchone() is not None

    def revoke(self, node):
        self.validate(node, '0' * 64)
        with self.connect() as db:
            db.execute('BEGIN IMMEDIATE')
            db.execute('UPDATE peers SET revoked=1 WHERE node=?', (node,))
            db.execute('UPDATE invitations SET used=1 WHERE node=?', (node,))
            db.execute('INSERT INTO events(kind,node,principal,time) VALUES (?,?,?,?)',
                       ('node_revoked', node, self.principal, self.clock()))
