"""Resumable local Linux login setup; not full NORI owner enrollment.

Runs as root on the physical console in the installed image. Tests inject an
account creator and password hasher against a temporary filesystem.
"""
from __future__ import annotations

import getpass
import json
import os
from pathlib import Path
import re
import subprocess
import tempfile


LOGIN = re.compile(r'[a-z][a-z0-9_-]{0,31}')


def atomic_text(path, value, mode=0o600):
    if path.is_symlink():
        raise ValueError('Linked setup file refused')
    descriptor, temporary = tempfile.mkstemp(prefix='.nori-setup-', dir=path.parent)
    try:
        os.chmod(temporary, mode)
        with os.fdopen(descriptor, 'w', encoding='utf-8', newline='\n') as stream:
            stream.write(value)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
        if os.name != 'nt':
            directory = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY)
            try:
                os.fsync(directory)
            finally:
                os.close(directory)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def create_account(login):
    subprocess.run(['adduser', '-D', '-s', '/bin/sh', login],
                   check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def password_hash(password):
    # BusyBox reads the password on stdin; it is never a process argument.
    result = subprocess.run(['mkpasswd', '-P', '0', '-m', 'sha512'],
                            input=password + '\n', text=True, capture_output=True,
                            check=True, timeout=15)
    value = result.stdout.strip()
    if not re.fullmatch(r'\$6\$[./A-Za-z0-9]{1,16}\$[./A-Za-z0-9]{86}', value):
        raise ValueError('Unsupported password hash')
    return value


class LinuxOwnerSetup:
    def __init__(self, root=Path('/'), *, creator=create_account, hasher=password_hash):
        self.root = Path(root)
        self.state = self.root / 'var/lib/nori/login-setup'
        self.pending = self.state / 'pending.json'
        self.marker = self.state / 'linux-login-configured'
        self.creator, self.hasher = creator, hasher

    def _check_paths(self):
        for path in (self.state, self.root / 'etc/passwd', self.root / 'etc/shadow'):
            for item in (path, *path.parents):
                if item.is_symlink():
                    raise ValueError('Linked account storage refused')
                if item == self.root:
                    break

    def pending_login(self):
        self._check_paths()
        if not self.pending.exists():
            return None
        if self.pending.is_symlink() or self.pending.stat().st_size > 4096:
            raise ValueError('Invalid account setup checkpoint')
        record = json.loads(self.pending.read_text(encoding='utf-8'))
        if (set(record) != {'schema', 'login'} or record['schema'] != 1 or
                not isinstance(record['login'], str) or not LOGIN.fullmatch(record['login'])):
            raise ValueError('Invalid account setup checkpoint')
        return record['login']

    def configured(self):
        self._check_paths()
        if not self.marker.exists():
            return False
        if self.marker.is_symlink():
            raise ValueError('Linked setup marker refused')
        login = self.marker.read_text(encoding='utf-8').strip()
        if not LOGIN.fullmatch(login):
            raise ValueError('Invalid account setup marker')
        passwd = (self.root / 'etc/passwd').read_text(encoding='utf-8')
        shadow = (self.root / 'etc/shadow').read_text(encoding='utf-8')
        return any(line.startswith(login + ':') for line in passwd.splitlines()) and any(
            line.startswith(login + ':$6$') for line in shadow.splitlines())

    def enroll(self, login, password):
        if not isinstance(login, str) or not LOGIN.fullmatch(login):
            raise ValueError('Use 1-32 lowercase letters, digits, underscores or hyphens; start with a letter')
        if not isinstance(password, str) or len(password) < 8 or any(c in password for c in '\r\n\0'):
            raise ValueError('Use at least 8 characters without line breaks')
        self._check_paths()
        self.state.mkdir(parents=True, exist_ok=True, mode=0o700)
        self.state.chmod(0o700)
        if self.marker.exists():
            raise PermissionError('Login already configured; use authenticated recovery')
        passwd = (self.root / 'etc/passwd').read_text(encoding='utf-8')
        exists = any(line.startswith(login + ':') for line in passwd.splitlines())
        pending = self.pending_login()
        if pending is not None and pending != login:
            raise PermissionError('Resume the pending login first')
        if pending is None:
            if exists:
                raise PermissionError('Existing account cannot be claimed through first boot')
            atomic_text(self.pending, json.dumps({'schema': 1, 'login': login}))
        hashed = self.hasher(password)
        if not re.fullmatch(r'\$6\$[./A-Za-z0-9]{1,16}\$[./A-Za-z0-9]{86}', hashed):
            raise ValueError('Unsupported password hash')
        if not exists:
            self.creator(login)
        passwd = (self.root / 'etc/passwd').read_text(encoding='utf-8')
        if sum(line.startswith(login + ':') for line in passwd.splitlines()) != 1:
            raise ValueError('Created account has no unique passwd entry')
        shadow_path = self.root / 'etc/shadow'
        lines = shadow_path.read_text(encoding='utf-8').splitlines()
        matches = [index for index, line in enumerate(lines) if line.startswith(login + ':')]
        if len(matches) != 1:
            raise ValueError('Created account has no unique shadow entry')
        fields = lines[matches[0]].split(':')
        if len(fields) != 9:
            raise ValueError('Invalid shadow entry')
        fields[1] = hashed
        lines[matches[0]] = ':'.join(fields)
        atomic_text(shadow_path, '\n'.join(lines) + '\n')
        atomic_text(self.marker, login + '\n')
        return login


def main():
    if os.name != 'posix' or os.geteuid() != 0:
        raise SystemExit('Local root console required')
    setup = LinuxOwnerSetup()
    if setup.configured():
        os.execv('/sbin/getty', ['getty', '-L', 'tty1', '0', 'linux'])
    print('\nN.O.R.I. Server — Create your local login\nNo default account or password.\n')
    login = setup.pending_login()
    if login:
        print('Resuming unfinished login setup for ' + login)
    while True:
        if login is None:
            login = input('Choose a login name: ').strip()
        password = getpass.getpass('Create password: ')
        confirmation = getpass.getpass('Confirm password: ')
        if password != confirmation:
            print('Passwords did not match.')
            continue
        try:
            setup.enroll(login, password)
            break
        except (ValueError, PermissionError) as error:
            print(str(error))
            login = setup.pending_login()
    del password, confirmation
    print('Local login ready. NORI identity and recovery enrollment remain separate setup steps.')
    os.execv('/sbin/getty', ['getty', '-L', 'tty1', '0', 'linux'])


if __name__ == '__main__':
    main()
