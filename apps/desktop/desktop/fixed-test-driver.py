"""Fixed host verification driver. No model-authored commands or credentials.

This is invoked by the Main-owned broker after project/session consent. The
existing Windows job executor supplies process-tree cleanup; it is not a sandbox.
"""
import asyncio
import hashlib
import json
from pathlib import Path
import re
import sys
import threading

UNITTEST_PROGRAM = r'''
import importlib.util, json, pathlib, sys, unittest
root=pathlib.Path(sys.argv[1]).resolve(strict=True)
files=json.loads(sys.argv[2])
sys.path.insert(0,str(root))
suite=unittest.TestSuite()
for index, relative in enumerate(files):
    target=(root/relative).resolve(strict=True)
    if root not in target.parents: raise ValueError('test path escaped project')
    spec=importlib.util.spec_from_file_location('nori_project_test_'+str(index),target)
    module=importlib.util.module_from_spec(spec)
    sys.modules[spec.name]=module
    spec.loader.exec_module(module)
    suite.addTests(unittest.defaultTestLoader.loadTestsFromModule(module))
result=unittest.TextTestRunner(verbosity=2).run(suite)
raise SystemExit(0 if result.wasSuccessful() else 1)
'''


async def run():
    raw = sys.argv[1]
    if len(raw.encode('utf-8')) > 65536:
        raise ValueError('verification request too large')
    request = json.loads(raw)
    required = {'task_id', 'suite_root', 'core_hashes', 'runner', 'project', 'files',
                'executable', 'executable_sha256', 'timeout_seconds'}
    if type(request) is not dict or set(request) != required:
        raise ValueError('invalid fixed verification request')
    if not re.fullmatch('[a-f0-9]{32}', request['task_id']):
        raise ValueError('invalid verification identity')
    if request['runner'] not in {'python-unittest', 'node-test'}:
        raise ValueError('unregistered verification runner')
    if type(request['timeout_seconds']) is not int or not 1 <= request['timeout_seconds'] <= 300:
        raise ValueError('invalid verification timeout')
    files = request['files']
    if type(files) is not list or not 1 <= len(files) <= 24:
        raise ValueError('invalid verification file count')
    root = Path(request['project'])
    if not root.is_absolute() or root.resolve(strict=True) != root:
        raise ValueError('linked verification project')
    for relative in files:
        if (type(relative) is not str or not re.fullmatch(r'[A-Za-z0-9_./-]{1,240}', relative)
                or any(part in {'', '.', '..'} for part in relative.split('/'))):
            raise ValueError('invalid project test path')
        target = root.joinpath(*relative.split('/'))
        if target.resolve(strict=True) != target or not target.is_file() or target.stat().st_nlink != 1:
            raise ValueError('linked or missing project test')
    suite_root = Path(request['suite_root'])
    if not suite_root.is_absolute() or suite_root.resolve(strict=True) != suite_root:
        raise ValueError('invalid public Core root')
    modules = request['core_hashes']
    expected = {'nori/__init__.py', 'nori/shared/__init__.py', 'nori/shared/control_plane/__init__.py',
                'nori/shared/control_plane/system_executor.py', 'nori/shared/control_plane/system_contract.py',
                'nori/shared/control_plane/windows_job.py', 'nori/shared/control_plane/system_output.py',
                'nori/shared/control_plane/v2.py'}
    if type(modules) is not dict or set(modules) != expected:
        raise ValueError('exact public Core dependency pins required')
    for relative, digest in modules.items():
        target = suite_root / relative
        if digest is None and relative == 'nori/shared/__init__.py' and not target.exists():
            continue
        if (target.resolve(strict=True) != target or target.stat().st_nlink != 1
                or hashlib.sha256(target.read_bytes()).hexdigest() != digest):
            raise ValueError('public verification dependency changed')
    sys.path.insert(0, str(suite_root))
    from nori.shared.control_plane.system_contract import SystemCommand
    from nori.shared.control_plane.system_executor import WindowsSystemExecutor
    command_args = (['-I', '-B', '-c', UNITTEST_PROGRAM, str(root), json.dumps(files)]
                    if request['runner'] == 'python-unittest'
                    else ['--test', *[str(root.joinpath(*name.split('/'))) for name in files]])
    command = SystemCommand(request['task_id'], request['executable'], request['executable_sha256'],
                            command_args, str(root),
                            ['Run trusted project tests with this Windows account; no sandbox claim.'],
                            request['timeout_seconds'])
    executor = WindowsSystemExecutor()
    loop = asyncio.get_running_loop()
    cancelled = threading.Event()

    def listen():
        if sys.stdin.readline().strip() == 'cancel':
            cancelled.set()
            loop.call_soon_threadsafe(lambda: asyncio.create_task(executor.cancel(request['task_id'])))

    threading.Thread(target=listen, daemon=True).start()
    before = {name: hashlib.sha256(root.joinpath(*name.split('/')).read_bytes()).hexdigest() for name in files}
    if cancelled.is_set():
        receipt = {'status': 'cancelled', 'executed': False, 'exit_code': None,
                   'process_tree_stopped': True, 'output_captured': False, 'stdout': '', 'stderr': ''}
    else:
        receipt = await executor.dispatch(command)
    after = {name: hashlib.sha256(root.joinpath(*name.split('/')).read_bytes()).hexdigest() for name in files}
    result = {'schema': 'nori.fixed-verification-result.v1', 'task_id': request['task_id'],
              'request_sha256': hashlib.sha256(raw.encode('utf-8')).hexdigest(),
              'runner': request['runner'], 'input_hashes_before': before,
              'input_hashes_after': after, 'receipt': receipt}
    print(json.dumps(result, ensure_ascii=True, separators=(',', ':')))


if __name__ == '__main__':
    asyncio.run(run())
