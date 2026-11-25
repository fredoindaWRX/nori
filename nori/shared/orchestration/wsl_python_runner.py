"""Disposable Python snapshots in NoriBuild's Linux namespace sandbox.

The Windows client only sends bounded source bytes. A trusted Linux supervisor
owns the deadline and kills the sandbox process group; stdin EOF also cancels.
No Windows paths, home folders, interop sockets or network enter the sandbox.
"""
from __future__ import annotations

import json
import hashlib
import base64
import os
from pathlib import Path
import subprocess
import threading
import time

from orchestration.isolated_python import snapshot, BOOTSTRAP, MAX_FILES
from security.hard_floor import HardFloorViolation, assert_output_safe

CONFIG = Path(__file__).resolve().parents[2] / "runtime-data/isolated-wsl-python.json"
MAX_TRANSPORT_BYTES = 2 * 131072 * 6 + 16384
MAX_MANIFEST_BYTES = 64 * 1024


def _snapshot_provenance(data):
    """Identify all admitted bytes without rereading mutable workspace files.

    The snapshot digest is SHA256 of the UTF-8 manifest JSON, sorted by path,
    with sorted object keys, no ASCII escaping, and compact comma/colon separators.
    """
    if len(data['files']) > MAX_FILES:
        raise HardFloorViolation('isolated_snapshot_manifest_limit')
    manifest = [{'path': path, 'sha256': hashlib.sha256(base64.b64decode(encoded, validate=True)).hexdigest()}
                for path, encoded in sorted(data['files'].items())]
    canonical = json.dumps(manifest, sort_keys=True, ensure_ascii=False, separators=(',', ':')).encode('utf-8')
    if len(canonical) > MAX_MANIFEST_BYTES:
        raise HardFloorViolation('isolated_snapshot_manifest_limit')
    assert_output_safe(canonical.decode('utf-8'))
    return {'snapshot_manifest': manifest,
            'snapshot_sha256': hashlib.sha256(canonical).hexdigest(),
            'script_sha256': next(item['sha256'] for item in manifest if item['path'] == data['script'])}

# This supervisor executes before untrusted code and stays outside its namespaces.
SUPERVISOR = r'''
import json, os, pathlib, selectors, signal, subprocess, sys, threading, time, uuid

def early(reason, status='denied'):
    print(json.dumps({'status':status, 'backend':'wsl-bubblewrap', 'executed':False,
                      'reason':reason, 'sandbox_stopped':True, 'cgroup_removed':True}), flush=True)
    sys.exit(0)

# Raw reads avoid buffering control EOF behind the payload. No sandbox starts
# unless the entire bounded request arrives before the admission deadline.
incoming = bytearray()
admission_deadline = time.monotonic()+75
input_selector = selectors.DefaultSelector()
input_selector.register(sys.stdin, selectors.EVENT_READ)
while not incoming.endswith(b'\n'):
    if time.monotonic() >= admission_deadline: early('input_timeout', 'failed')
    if not input_selector.select(.05): continue
    chunk = os.read(sys.stdin.fileno(), 65536)
    if not chunk: early('cancelled', 'cancelled')
    incoming.extend(chunk)
    if len(incoming)>6000000: early('input_limit', 'failed')
input_selector.close()
setup = json.loads(incoming)
timeout = setup.pop('_timeout')
bootstrap = setup.pop('_bootstrap')
if type(timeout) is not int or not 1 <= timeout <= 60: early('invalid_timeout')
cancel = threading.Event()
def control():
    os.read(sys.stdin.fileno(), 1)
    cancel.set()  # explicit CANCEL or closed host connection
threading.Thread(target=control, daemon=True).start()

# These are aggregate kernel limits over every descendant. The supervisor stays
# outside the group so an OOM or PID exhaustion cannot disable cleanup.
group = None
try:
    cgroup_root = pathlib.Path('/sys/fs/cgroup')
    required = {'memory', 'pids', 'cpu'}
    if not required <= set((cgroup_root/'cgroup.controllers').read_text().split()):
        raise RuntimeError('required controllers unavailable')
    enabled = set((cgroup_root/'cgroup.subtree_control').read_text().split())
    missing = required-enabled
    if missing: (cgroup_root/'cgroup.subtree_control').write_text(' '.join('+'+name for name in sorted(missing)))
    group = cgroup_root/('nori-python-'+uuid.uuid4().hex)
    group.mkdir()
    limits = {'memory.max':'536870912', 'memory.swap.max':'0', 'memory.oom.group':'1',
              'pids.max':'64', 'cpu.max':'100000 100000'}
    for name, value in limits.items():
        (group/name).write_text(value)
        if (group/name).read_text().strip() != value: raise RuntimeError('limit verification failed')
    if not (group/'cgroup.kill').exists(): raise RuntimeError('atomic group kill unavailable')
except Exception:
    if group is not None:
        try: group.rmdir()
        except OSError: pass
    early('isolated_cgroup_limits_unavailable')

command = ['/usr/bin/bwrap', '--unshare-all', '--unshare-user', '--disable-userns',
    '--die-with-parent', '--new-session', '--uid', '65534', '--gid', '65534',
    '--cap-drop', 'ALL', '--clearenv', '--setenv', 'PATH', '/usr/bin',
    '--setenv', 'HOME', '/tmp', '--setenv', 'PYTHONUNBUFFERED', '1',
    '--setenv', 'LD_LIBRARY_PATH', '/usr/lib/x86_64-linux-gnu/blas:/usr/lib/x86_64-linux-gnu/lapack',
    '--setenv', 'OPENBLAS_NUM_THREADS', '1', '--setenv', 'OMP_NUM_THREADS', '1',
    '--setenv', 'MATPLOTLIBRC', '/usr/share/matplotlib/mpl-data/matplotlibrc',
    '--setenv', 'MPLBACKEND', 'Agg', '--setenv', 'MPLCONFIGDIR', '/tmp/matplotlib',
    '--ro-bind', '/usr', '/usr', '--symlink', 'usr/bin', '/bin',
    '--symlink', 'usr/lib', '/lib', '--symlink', 'usr/lib64', '/lib64',
    '--proc', '/proc', '--dev', '/dev',
    '--perms', '0777', '--size', '67108864', '--tmpfs', '/work',
    '--perms', '0777', '--size', '33554432', '--tmpfs', '/tmp',
    '--chdir', '/work', '--remount-ro', '/', '/usr/bin/python3', '-I', '-B', '-c', bootstrap]
# A fresh trusted interpreter joins the group before exec. Avoid preexec_fn in
# this multithreaded supervisor, and never run user code before membership.
launcher = "import os,pathlib,resource,sys; pathlib.Path(sys.argv[1],'cgroup.procs').write_text(str(os.getpid())); " \
           "resource.setrlimit(resource.RLIMIT_AS,(768*1024*1024,)*2); " \
           "resource.setrlimit(resource.RLIMIT_NOFILE,(128,128)); " \
           "resource.setrlimit(resource.RLIMIT_FSIZE,(16*1024*1024,)*2); " \
           "resource.setrlimit(resource.RLIMIT_CORE,(0,0)); " \
           "resource.setrlimit(resource.RLIMIT_CPU,(int(sys.argv[2])+1,)*2); os.execv(sys.argv[3],sys.argv[3:])"
p = None
output = {'stdout':bytearray(), 'stderr':bytearray()}
reason = None
cleanup_ok = False
metrics = {}
selector = selectors.DefaultSelector()
try:
    if cancel.is_set():
        reason = 'cancelled'
    else:
        p = subprocess.Popen(['/usr/bin/python3','-I','-c',launcher,str(group),str(timeout),*command],
                             stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                             start_new_session=True, bufsize=0, env={'PATH':'/usr/bin'})
        def feed():
            try:
                remaining = memoryview(json.dumps(setup).encode()+b'\n')
                while remaining:
                    sent = p.stdin.write(remaining[:65536])
                    if not sent: break
                    remaining = remaining[sent:]
                p.stdin.close()
            except (BrokenPipeError, OSError): pass
        threading.Thread(target=feed, daemon=True).start()
        for name in ('stdout', 'stderr'): selector.register(getattr(p, name), selectors.EVENT_READ, name)
        deadline = time.monotonic()+timeout
        while selector.get_map() or p.poll() is None:
            if cancel.is_set(): reason = 'cancelled'; break
            if time.monotonic() >= deadline: reason = 'timeout'; break
            for key, _ in selector.select(.05):
                chunk = os.read(key.fileobj.fileno(), 4096)
                if not chunk: selector.unregister(key.fileobj); continue
                target = output[key.data]
                available = 131072-len(target)
                target.extend(chunk[:available])
                if len(chunk)>available: reason = 'output_limit'; break
            if reason: break
except Exception:
    reason = 'sandbox_start_failed'
finally:
    try:
        (group/'cgroup.kill').write_text('1')
        if p is not None:
            try: os.killpg(p.pid, signal.SIGKILL)
            except ProcessLookupError: pass
            p.wait(timeout=3)
        empty_deadline = time.monotonic()+3
        while 'populated 1' in (group/'cgroup.events').read_text():
            if time.monotonic() >= empty_deadline: raise RuntimeError('group still populated')
            time.sleep(.02)
        for name in ('memory.peak', 'memory.events', 'pids.events'):
            metrics[name] = (group/name).read_text().strip()
        group.rmdir()
        cleanup_ok = True
    except Exception:
        reason = 'isolated_cleanup_unconfirmed'
    selector.close()
result = {'status':'cancelled' if reason=='cancelled' else 'completed' if reason is None and p is not None and p.returncode==0 else 'failed',
          'backend':'wsl-bubblewrap', 'executed':p is not None, 'exit_code':p.returncode if p is not None else None,
          'reason':reason, 'sandbox_stopped':cleanup_ok, 'cgroup_removed':cleanup_ok,
          'resource_limits':{'memory_bytes':536870912, 'pids':64, 'cpu_cores':1}, 'resource_usage':metrics,
          'output_truncated':reason=='output_limit',
          'stdout':output['stdout'].decode(errors='replace'), 'stderr':output['stderr'].decode(errors='replace'),
          'artifacts':[], 'filesystem_scope':'ephemeral task snapshot; generated files are not exported'}
print(json.dumps(result), flush=True)
'''


class WslPythonRunner:
    def __init__(self, distro="NoriBuild"):
        if distro != "NoriBuild" or os.name != "nt":
            raise HardFloorViolation("isolated_wsl_backend_unavailable")
        self.distro = distro
        self.wsl = str(Path(os.environ["SystemRoot"]) / "System32/wsl.exe")
        self.environment = {key: os.environ[key] for key in (
            "SystemRoot", "WINDIR", "TEMP", "TMP", "USERPROFILE", "LOCALAPPDATA") if key in os.environ}
        self.quarantined = False

    @classmethod
    def configured(cls):
        try:
            settings = json.loads(CONFIG.read_text(encoding="utf-8"))
        except (OSError, ValueError) as error:
            raise HardFloorViolation("isolated_wsl_not_provisioned") from error
        if settings != {"schema":"nori.isolated-wsl-python.v1", "distro":"NoriBuild"}:
            raise HardFloorViolation("isolated_wsl_configuration_invalid")
        return cls(settings["distro"])

    @staticmethod
    def _interrupt_write(writer):
        """Cancel a Windows thread's synchronous pipe write without buffer locks."""
        if os.name != 'nt' or writer.native_id is None:
            return
        import ctypes
        from ctypes import wintypes
        kernel = ctypes.WinDLL('kernel32', use_last_error=True)
        kernel.OpenThread.argtypes = [wintypes.DWORD, wintypes.BOOL, wintypes.DWORD]
        kernel.OpenThread.restype = wintypes.HANDLE
        kernel.CancelSynchronousIo.argtypes = [wintypes.HANDLE]
        kernel.CancelSynchronousIo.restype = wintypes.BOOL
        kernel.CloseHandle.argtypes = [wintypes.HANDLE]
        kernel.CloseHandle.restype = wintypes.BOOL
        handle = kernel.OpenThread(0x0001, False, writer.native_id)  # THREAD_TERMINATE
        if handle:
            try: kernel.CancelSynchronousIo(handle)
            finally: kernel.CloseHandle(handle)

    def run(self, workspace, relative_script, arguments=None, timeout=30, cancelled=None):
        if type(timeout) is not int or not 1 <= timeout <= 60:
            raise ValueError("Timeout must be 1 to 60 seconds")
        if self.quarantined:
            raise HardFloorViolation("isolated_cleanup_unconfirmed")
        cancelled = cancelled or (lambda:False)
        if cancelled():
            return {"status":"cancelled", "backend":"wsl-bubblewrap", "executed":False}
        data = json.loads(snapshot(workspace, relative_script, arguments or []))
        provenance = _snapshot_provenance(data)
        data.update(_timeout=timeout, _bootstrap=BOOTSTRAP)
        payload = json.dumps(data).encode()+b'\n'
        process = subprocess.Popen([self.wsl, '-d', self.distro, '--', '/usr/bin/python3', '-I', '-c', SUPERVISOR],
            env=self.environment, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
            bufsize=0, creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
        output = {}
        transport_overflow = threading.Event()
        # Only the trusted supervisor writes these streams, with bounded output.
        def read(name):
            collected = bytearray()
            with getattr(process, name) as stream:
                while True:
                    chunk = stream.read(65536)
                    if not chunk: break
                    available = MAX_TRANSPORT_BYTES-len(collected)
                    collected.extend(chunk[:available])
                    if len(chunk)>available: transport_overflow.set()
            output[name] = bytes(collected)
        readers = [threading.Thread(target=read, args=(name,), daemon=True) for name in ('stdout','stderr')]
        for reader in readers: reader.start()
        write_error = []
        stop_delivery = threading.Event()
        def feed():
            try:
                remaining = memoryview(payload)
                while remaining and not stop_delivery.is_set():
                    sent = process.stdin.write(remaining[:65536])
                    if not sent: raise OSError('input delivery stopped')
                    remaining = remaining[sent:]
            except OSError as error:
                if not stop_delivery.is_set(): write_error.append(type(error).__name__)
        writer = threading.Thread(target=feed, daemon=True); writer.start()

        def close_input():
            stop_delivery.set()
            # A raw FileIO avoids BufferedWriter's cross-thread close lock.
            # Interrupt before close so even a stalled WSL reader cannot hold us.
            for _ in range(10):
                if not writer.is_alive(): break
                self._interrupt_write(writer)
                writer.join(timeout=.05)
            if writer.is_alive():
                return False
            try: process.stdin.close()
            except OSError: pass
            return True

        deadline = time.monotonic()+timeout+15
        requested_cancel = False
        try:
            while process.poll() is None and time.monotonic()<deadline:
                if (cancelled() or transport_overflow.is_set()) and not requested_cancel:
                    if not close_input():
                        self.quarantined = True
                        raise HardFloorViolation("isolated_input_cancellation_unconfirmed")
                    requested_cancel = True
                    deadline = min(deadline, time.monotonic()+5)
                time.sleep(.05)
            if process.poll() is None:
                # Closing stdin asks the Linux supervisor to kill its namespace.
                if not close_input():
                    self.quarantined = True
                    raise HardFloorViolation("isolated_input_cancellation_unconfirmed")
                try: process.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    self.quarantined = True
                    process.kill(); process.wait(timeout=3)
                    raise HardFloorViolation("isolated_cleanup_unconfirmed")
        finally:
            if process.poll() is None:
                # On client exceptions the pipe is closed, not abandoned live.
                try:
                    if not close_input(): raise OSError('input writer did not stop')
                    process.wait(timeout=5)
                except (OSError, subprocess.TimeoutExpired):
                    self.quarantined = True; process.kill(); process.wait(timeout=3)
            for reader in readers: reader.join(timeout=3)
            close_input()
        if process.returncode != 0 or write_error:
            self.quarantined = True
            raise HardFloorViolation("isolated_wsl_supervisor_failed")
        if transport_overflow.is_set():
            self.quarantined = True
            raise HardFloorViolation("isolated_wsl_result_limit")
        try: result = json.loads(output.get('stdout', b''))
        except ValueError as error:
            self.quarantined = True
            raise HardFloorViolation("isolated_wsl_result_unavailable") from error
        if result.get('sandbox_stopped') is not True:
            self.quarantined = True
            raise HardFloorViolation("isolated_cleanup_unconfirmed")
        assert_output_safe(json.dumps(result, ensure_ascii=False))
        result.update(provenance)
        return result
