"""Host-supervised Python execution in a disposable local Docker container.

Only a bounded task snapshot crosses stdin. There are no host mounts, network,
Docker socket, owner credentials, raw devices, or privileged capabilities in the
container. Provisioning the trusted Python image is a separate owner/host action.
The existing deny-only hard-floor helper is not weakened by this adapter.
"""
from __future__ import annotations

import base64
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import stat
import subprocess
import threading
import time
from uuid import uuid4

from security.hard_floor import HardFloorViolation, assert_file_allowed, assert_output_safe
from orchestration.workspace_paths import reject_link

MAX_FILES = 128
MAX_FILE_BYTES = 512 * 1024
MAX_TOTAL_BYTES = 4 * 1024 * 1024
MAX_OUTPUT_BYTES = 128 * 1024
CONFIG = Path(__file__).resolve().parents[2] / 'runtime-data/isolated-python.json'

# This code runs inside the constrained container. User code cannot change the
# host command, mounts, resource limits, or supervisor's cancellation deadline.
BOOTSTRAP = r'''
import base64, json, os, pathlib, runpy, sys
payload = json.loads(sys.stdin.buffer.readline(6000000))
for name, encoded in payload['files'].items():
    target = pathlib.Path('/work') / name
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(base64.b64decode(encoded, validate=True))
os.chdir('/work')
sys.argv = [payload['script']] + payload['arguments']
sys.path.insert(0, str((pathlib.Path('/work') / payload['script']).parent))
sys.path.insert(0, '/work')
runpy.run_path(payload['script'], run_name='__main__')
'''.strip()


def _relative(value):
    if not isinstance(value, str) or not value or '\\' in value or ':' in value:
        raise ValueError('Relative POSIX task path required')
    path = PurePosixPath(value)
    if path.is_absolute() or '..' in path.parts or '.' == value:
        raise ValueError('Relative POSIX task path required')
    return path.as_posix()


def snapshot(workspace, script, arguments):
    original = Path(workspace)
    # Inspect the requested root before resolution can follow a Windows junction.
    reject_link(original)
    root = original.resolve(strict=True)
    if not root.is_dir():
        raise ValueError('A regular task directory is required')
    script = _relative(script)
    if not script.endswith('.py'):
        raise ValueError('Only Python task scripts are supported')
    if not isinstance(arguments, list) or len(arguments) > 16 or any(
            not isinstance(arg, str) or len(arg) > 160 or '\x00' in arg for arg in arguments):
        raise ValueError('Invalid script arguments')
    files = {}; total = 0
    for directory, folders, names in os.walk(root, followlinks=False):
        for name in folders + names:
            path = Path(directory) / name
            info = path.lstat()
            if stat.S_ISLNK(info.st_mode) or getattr(info, 'st_file_attributes', 0) & 1024:
                raise HardFloorViolation('isolated_task_links_forbidden')
            if name in folders:
                continue
            if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1:
                raise HardFloorViolation('isolated_task_regular_files_required')
            assert_file_allowed(path, operation='read')
            if info.st_size > MAX_FILE_BYTES or len(files) >= MAX_FILES:
                raise ValueError('Task snapshot limit exceeded')
            data = path.read_bytes()
            total += len(data)
            if total > MAX_TOTAL_BYTES or len(data) > MAX_FILE_BYTES:
                raise ValueError('Task snapshot limit exceeded')
            assert_output_safe(data.decode('utf-8', errors='replace'))
            relative = _relative(path.relative_to(root).as_posix())
            files[relative] = base64.b64encode(data).decode('ascii')
    if script not in files:
        raise ValueError('Python script is missing from task snapshot')
    return json.dumps({'files': files, 'script': script, 'arguments': arguments}, separators=(',', ':')).encode() + b'\n'


class DockerPythonRunner:
    def __init__(self, image_id, docker_path=None):
        if not isinstance(image_id, str) or not re.fullmatch(r'sha256:[0-9a-f]{64}', image_id):
            raise ValueError('Provision a pinned local Docker image ID')
        self.image_id = image_id
        executable = docker_path or shutil.which('docker')
        if not executable or not Path(executable).is_file():
            raise HardFloorViolation('isolated_docker_cli_unavailable')
        self.docker = str(Path(executable).resolve())
        self.endpoint = 'npipe:////./pipe/dockerDesktopLinuxEngine' if os.name == 'nt' else 'unix:///var/run/docker.sock'
        # Prevent inherited Docker contexts/remote hosts, API keys, or Python
        # environment variables affecting the supervisor's Docker client.
        self.environment = {key: os.environ[key] for key in ('SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'PATH') if key in os.environ}
        self._cleanup_unconfirmed = False

    @classmethod
    def configured(cls, path=CONFIG):
        try:
            settings = json.loads(Path(path).read_text(encoding='utf-8'))
        except (OSError, ValueError) as error:
            raise HardFloorViolation('isolated_python_not_provisioned') from error
        if set(settings) != {'schema', 'image_id'} or settings.get('schema') != 'nori.isolated-python.v1':
            raise HardFloorViolation('isolated_python_configuration_invalid')
        return cls(settings['image_id'])

    def _command(self, *arguments):
        return [self.docker, '--host', self.endpoint, *arguments]

    def _run_cli(self, arguments, timeout=10):
        return subprocess.run(self._command(*arguments), env=self.environment,
            stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=timeout,
            creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0), check=False)

    def health(self):
        if self._cleanup_unconfirmed:
            return {'available': False, 'backend': 'docker-local',
                    'reason': 'container_cleanup_unconfirmed'}
        try:
            result = self._run_cli(['image', 'inspect', self.image_id, '--format', '{{.Id}} {{.Os}}'])
            available = result.returncode == 0 and result.stdout.decode().strip() == self.image_id + ' linux'
            return {'available': available, 'backend': 'docker-local',
                    'reason': None if available else 'isolated_python_image_or_engine_unavailable'}
        except (OSError, subprocess.TimeoutExpired):
            return {'available': False, 'backend': 'docker-local', 'reason': 'isolated_docker_engine_unavailable'}

    def _creation_arguments(self, name):
        if not re.fullmatch(r'nori-task-[0-9a-f]{32}', name):
            raise ValueError('Invalid supervisor container name')
        # Creation cannot execute user code. Only the subsequently validated ID
        # may be started, so cancelling a slow launch cannot race a new container.
        return ['create', '--pull=never', '--name', name,
            '--label', 'nori.owner=isolated-python', '--network=none', '--ipc=private',
            '--read-only', '--user', '65534:65534', '--cap-drop=ALL',
            '--security-opt=no-new-privileges=true', '--pids-limit=64',
            '--memory=512m', '--memory-swap=512m', '--cpus=1',
            '--ulimit', 'nofile=256:256', '--ulimit', 'fsize=16777216:16777216',
            '--tmpfs', '/work:rw,noexec,nosuid,nodev,size=64m,uid=65534,gid=65534,mode=700',
            '--tmpfs', '/tmp:rw,noexec,nosuid,nodev,size=32m,uid=65534,gid=65534,mode=700',
            '--workdir', '/work', '--env', 'HOME=/tmp', '--env', 'PYTHONUNBUFFERED=1',
            '--log-driver=none', '-i', '--entrypoint', 'python3', self.image_id,
            '-I', '-B', '-c', BOOTSTRAP]

    def command(self, name):
        return self._command(*self._creation_arguments(name))

    def _remove_container(self, reference):
        try:
            self._run_cli(['rm', '-f', reference])
            selector = ('id=' + reference if re.fullmatch(r'[0-9a-f]{64}', reference)
                        else 'name=^/' + reference + '$')
            remaining = self._run_cli(['container', 'ls', '--all', '--quiet',
                                       '--no-trunc', '--filter', selector])
            # A successful engine response establishes absence. A failed rm or
            # an unavailable engine must never be mistaken for proof of cleanup.
            return remaining.returncode == 0 and not remaining.stdout.strip()
        except (OSError, subprocess.TimeoutExpired):
            return False

    def run(self, workspace, relative_script, arguments=None, timeout=30, cancelled=None):
        if type(timeout) is not int or not 1 <= timeout <= 60:
            raise ValueError('Timeout must be 1 to 60 seconds')
        cancelled = cancelled or (lambda: False)
        if cancelled():
            return {'status': 'cancelled', 'backend': 'docker-local', 'executed': False}
        payload = snapshot(workspace, relative_script, arguments or [])
        readiness = self.health()
        if not readiness['available']:
            raise HardFloorViolation(readiness['reason'])
        if cancelled():
            return {'status': 'cancelled', 'backend': 'docker-local', 'executed': False}
        name = 'nori-task-' + uuid4().hex
        buffers = {'stdout': bytearray(), 'stderr': bytearray()}
        output_limit = threading.Event()
        process = None; container_id = None; writer = None; readers = []
        creation_unconfirmed = False
        def read_stream(kind, stream):
            try:
                while True:
                    block = stream.read(4096)
                    if not block: break
                    remaining = MAX_OUTPUT_BYTES - len(buffers[kind])
                    buffers[kind].extend(block[:remaining])
                    if len(block) > remaining: output_limit.set()
            finally:
                stream.close()
        write_failure = threading.Event()
        def feed():
            try: process.stdin.write(payload); process.stdin.close()
            except (OSError, ValueError): write_failure.set()
        reason = None; cleanup_ok = True
        deadline = time.monotonic() + timeout
        try:
            creation = self._run_cli(self._creation_arguments(name), timeout=min(timeout, 10))
            identifier = creation.stdout.decode(errors='replace').strip()
            if creation.returncode != 0 or not re.fullmatch(r'[0-9a-f]{64}', identifier):
                creation_unconfirmed = True
                reason = 'container_creation_unconfirmed'
            else:
                container_id = identifier
                if cancelled():
                    reason = 'cancelled'
                elif time.monotonic() >= deadline:
                    reason = 'timeout'
                else:
                    process = subprocess.Popen(self._command('start', '--attach', '--interactive', container_id),
                        env=self.environment, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                        stderr=subprocess.PIPE, creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
                    readers = [threading.Thread(target=read_stream, args=(kind, getattr(process, kind)), daemon=True)
                               for kind in buffers]
                    for reader in readers: reader.start()
                    writer = threading.Thread(target=feed, daemon=True); writer.start()
                    while process.poll() is None:
                        if cancelled(): reason = 'cancelled'; break
                        if output_limit.is_set(): reason = 'output_limit'; break
                        if time.monotonic() >= deadline: reason = 'timeout'; break
                        time.sleep(.05)
        except (OSError, subprocess.TimeoutExpired):
            creation_unconfirmed = container_id is None
            reason = 'container_creation_unconfirmed' if creation_unconfirmed else 'container_start_failed'
        finally:
            cleanup_ok = self._remove_container(container_id or name)
            # A timed-out or malformed create response can have outstanding
            # daemon work. It never starts user code, but absence now is not
            # proof that a stopped container cannot appear later.
            cleanup_ok = cleanup_ok and not creation_unconfirmed
            if not cleanup_ok:
                self._cleanup_unconfirmed = True
            if process is not None and process.poll() is None:
                try: process.wait(timeout=3)
                except subprocess.TimeoutExpired: process.kill(); process.wait(timeout=3)
            if writer is not None: writer.join(timeout=1)
            for reader in readers: reader.join(timeout=2)
        stdout = bytes(buffers['stdout']).decode(errors='replace')
        stderr = bytes(buffers['stderr']).decode(errors='replace')
        assert_output_safe(stdout); assert_output_safe(stderr)
        if not cleanup_ok: reason = 'container_cleanup_unconfirmed'
        if output_limit.is_set() and reason is None: reason = 'output_limit'
        if write_failure.is_set() and reason is None: reason = 'input_delivery_failed'
        return {'status': 'cancelled' if reason == 'cancelled' else 'completed' if reason is None and process is not None and process.returncode == 0 else 'failed',
                'backend': 'docker-local', 'executed': process is not None,
                'exit_code': process.returncode if process is not None else None,
                'stdout': stdout, 'stderr': stderr, 'reason': reason,
                'output_truncated': output_limit.is_set(), 'container_removed': cleanup_ok,
                'artifacts': [], 'filesystem_scope': 'ephemeral task snapshot; generated files are not exported'}
