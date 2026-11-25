"""Read-only filename discovery in the configured owner's Downloads folder."""
from pathlib import Path


def discover_downloads(query, root=None):
    if not isinstance(query, str) or not 2 <= len(query.strip()) <= 100:
        raise ValueError('Provide 2 to 100 characters from the filename')
    query = query.strip().casefold()
    folder = Path(root) if root is not None else Path.home() / 'Downloads'
    if not folder.is_dir():
        raise ValueError('Owner Downloads directory is unavailable')
    matches = []
    scanned = 0
    for entry in folder.iterdir():
        scanned += 1
        if scanned > 10000:
            return {'matches': matches, 'truncated': True}
        if query not in entry.name.casefold() or entry.is_symlink():
            continue
        try:
            if not entry.is_file() or entry.resolve().parent != folder.resolve():
                continue
            matches.append({'name': entry.name, 'bytes': entry.stat().st_size})
        except OSError:
            continue
        if len(matches) >= 50:
            return {'matches': matches, 'truncated': True}
    return {'matches': matches, 'truncated': False}
