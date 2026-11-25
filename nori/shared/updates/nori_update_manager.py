"""NORI-owned update verification and atomic staging primitives."""
from hashlib import sha256
from pathlib import Path
import os, tempfile

def digest(path: Path) -> str:
    h=sha256()
    with path.open('rb') as f:
        for chunk in iter(lambda:f.read(1024*1024),b''): h.update(chunk)
    return h.hexdigest()

def verify(path: Path, expected: str) -> None:
    if not path.is_file(): raise FileNotFoundError(path)
    if digest(path).lower()!=expected.lower(): raise ValueError('update checksum mismatch')

def stage(path: Path, destination: Path, expected: str) -> Path:
    verify(path,expected); destination.parent.mkdir(parents=True,exist_ok=True)
    fd,tmp=tempfile.mkstemp(prefix='.nori-update-',dir=str(destination.parent)); os.close(fd)
    tmp_path=Path(tmp)
    try:
        tmp_path.write_bytes(path.read_bytes()); os.replace(tmp_path,destination)
    finally:
        if tmp_path.exists(): tmp_path.unlink()
    return destination
