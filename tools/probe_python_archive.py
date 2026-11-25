"""Offline, isolated standard-library archive experiment; no active-runtime edits."""
import json
from pathlib import Path
import shutil
import subprocess
import tempfile
import zipfile


def probe(suite):
    suite = Path(suite).resolve(strict=True)
    source = suite / "python" / "Python311"
    target = Path(tempfile.mkdtemp(prefix=".python-archive-probe-", dir=suite / "verification"))
    library = source / "Lib"
    files = 0
    for item in source.iterdir():
        if item.is_symlink():
            raise ValueError("Linked interpreter input refused")
        if item.is_file() and item.suffix.lower() in {".exe", ".dll", ".txt"}:
            shutil.copyfile(item, target / item.name)
    extensions = source / "DLLs"
    for item in extensions.rglob("*"):
        if item.is_symlink():
            raise ValueError("Linked extension input refused")
        if item.is_file():
            destination = target / "DLLs" / item.relative_to(extensions)
            destination.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(item, destination)
    # Stored members avoid requiring a decompressor to bootstrap encodings.
    with zipfile.ZipFile(target / "python311.zip", "x", compression=zipfile.ZIP_STORED) as archive:
        for item in sorted(library.rglob("*")):
            if item.is_symlink():
                raise ValueError("Linked library input refused")
            if item.is_file() and "__pycache__" not in item.parts and item.suffix not in {".pyc", ".pyo"}:
                archive.write(item, item.relative_to(library).as_posix())
                files += 1
    validation = '''
import asyncio, ctypes, email, encodings, hashlib, http.server, json, logging
import multiprocessing, pathlib, queue, socket, sqlite3, ssl, subprocess, sys
import tempfile, threading, urllib.request, zipfile
assert 'python311.zip' in encodings.__file__
assert 'python311.zip' in asyncio.__file__
with sqlite3.connect(':memory:') as db:
    assert db.execute('select 42').fetchone()[0] == 42
assert asyncio.run(asyncio.sleep(0, result=42)) == 42
ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
print(json.dumps({'prefix':sys.prefix,'encodings':encodings.__file__,
 'asyncio':asyncio.__file__,'sqlite':sqlite3.sqlite_version,'ssl':ssl.OPENSSL_VERSION}))
'''
    result = subprocess.run([str(target / "python.exe"), "-I", "-B", "-c", validation],
        cwd=target, capture_output=True, text=True, timeout=30, check=False,
        creationflags=subprocess.CREATE_NO_WINDOW)
    receipt = {"target": str(target), "archived_files": files, "exit": result.returncode,
               "stdout": result.stdout, "stderr": result.stderr,
               "active_runtime_changed": False, "suite_qualified": False,
               "frozen_executable": False}
    (target / "probe-receipt.json").write_text(json.dumps(receipt, indent=2), encoding="utf-8")
    return receipt


if __name__ == "__main__":
    print(json.dumps(probe(Path(__file__).resolve().parents[1])))
