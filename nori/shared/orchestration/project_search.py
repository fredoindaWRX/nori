"""Bounded, read-only source discovery with the same admission as project_read."""
import os
import time
from pathlib import Path

from orchestration.workspace_paths import workspace_path, reject_link
from security.hard_floor import HardFloorViolation

EXCLUDED = {'runtime-data', 'secrets', 'logs', 'data', 'backups', 'node_modules',
            'intermediate', 'saved', 'binaries', 'deriveddatacache', 'build', 'dist',
            'venv', 'env', '__pycache__', 'site-packages'}


def search_project(worker, query, directory=''):
    if not isinstance(query, str) or not query.strip() or len(query) > 120:
        raise ValueError('Use a search term of 1 to 120 characters')
    if not isinstance(directory, str):
        raise ValueError('directory must be a relative source folder or empty')
    if worker.project_root is None:
        return {'status': 'denied', 'reason': 'project_source_not_configured'}
    decision = worker.policy.decide('workspace_read')
    if not decision.allowed:
        return {'status': 'denied', 'reason': decision.reason}
    root = Path(worker.project_root).resolve()
    start = workspace_path(root, directory) if directory else root
    reject_link(start)
    if not start.is_dir():
        raise ValueError('Search directory is not a folder: ' + directory[:160] + '. Use project_read/project_stage for an exact file path, or search its parent directory.')
    from orchestration.neo_worker import SOURCE_SUFFIXES
    needle = query.strip().casefold()
    matches, examined, skipped, truncated = [], 0, 0, False
    deadline = time.monotonic() + 4
    bytes_read = 0
    for folder, dirs, files in os.walk(start, followlinks=False):
        admitted = []
        for name in sorted(dirs):
            if name.startswith('.') or name.casefold() in EXCLUDED or name.casefold().startswith(('packaged', 'venv')):
                continue
            try:
                workspace_path(root, (Path(folder) / name).relative_to(root).as_posix())
                admitted.append(name)
            except (ValueError, OSError, HardFloorViolation):
                skipped += 1
        dirs[:] = admitted
        for name in sorted(files):
            if time.monotonic() >= deadline or examined >= 2000 or bytes_read >= 16 * 1024 * 1024 or len(matches) >= 60:
                truncated = True
                break
            if name.startswith('.') or Path(name).suffix.lower() not in SOURCE_SUFFIXES:
                continue
            relative = (Path(folder) / name).relative_to(root).as_posix()
            try:
                path = workspace_path(root, relative)
                size = path.stat().st_size
                if size > 512 * 1024:
                    skipped += 1
                    continue
                examined += 1
                bytes_read += size
                # Full-file screening precedes path/line results so secrets cannot
                # be exposed piecemeal through snippets or filename matching.
                content = worker._read_text(path)
                if needle in relative.casefold():
                    matches.append({'path': relative, 'match': 'filename'})
                for number, line in enumerate(content.splitlines(), 1):
                    if len(matches) >= 60:
                        truncated = True
                        break
                    if needle in line.casefold():
                        matches.append({'path': relative, 'line': number, 'text': line[:300]})
            except (ValueError, OSError, UnicodeError, HardFloorViolation):
                skipped += 1
        if truncated:
            break
    return {'status': 'completed', 'query': query, 'directory': directory,
            'matches': matches, 'files_examined': examined, 'skipped': skipped,
            'truncated': truncated, 'scope': 'admitted project source only',
            'next_step': 'Use project_read for matching paths. Narrow directory when truncated.'}
