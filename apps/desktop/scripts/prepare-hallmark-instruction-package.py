"""Build a bounded instruction package; never execute downloaded code."""
import hashlib
import importlib.util
import json
from pathlib import Path, PurePosixPath
import stat
import zipfile

source = Path(r'C:\Users\Studio\Downloads\hallmark-main.zip')
target = Path(r'C:\Nori\outputs\skill-packages\hallmark-2.0.0-nori-instructions.zip')
prefix = 'hallmark-main/skills/hallmark/'
worker = Path(r'C:\Program Files\Nori\resources\NoriSuite\nori\local_skill_installer.py')
spec = importlib.util.spec_from_file_location('nori_installed_skill_inspector', worker)
inspector = importlib.util.module_from_spec(spec)
spec.loader.exec_module(inspector)
source_digest = hashlib.sha256(source.read_bytes()).hexdigest()
selected = {}
with zipfile.ZipFile(source) as archive:
    for entry in archive.infolist():
        if not entry.filename.startswith(prefix) or entry.is_dir():
            continue
        relative = entry.filename[len(prefix):]
        parts = inspector.safe_parts(relative)
        if stat.S_IFMT(entry.external_attr >> 16) not in (0, stat.S_IFREG):
            raise ValueError('Links and special files are refused')
        if not 0 <= entry.file_size <= inspector.MAX_FILE:
            raise ValueError('Selected skill file exceeds the limit')
        if relative.casefold() in {name.casefold() for name in selected}:
            raise ValueError('Duplicate skill entry')
        if sum(len(data) for data in selected.values()) + entry.file_size > inspector.MAX_EXPANDED:
            raise ValueError('Selected skill exceeds the expanded-size limit')
        selected[PurePosixPath(*parts).as_posix()] = archive.read(entry)
assert 'SKILL.md' in selected and 'LICENSE' in selected
target.parent.mkdir(parents=True, exist_ok=True)
if target.exists():
    raise FileExistsError('Existing package preserved')
provenance = json.dumps({'schema': 'nori.local-repack-provenance.v1',
    'original_archive_name': source.name, 'original_archive_sha256': source_digest,
    'selected_prefix': prefix, 'original_file_bytes_changed': False,
    'bundled_code_executed': False}, indent=2).encode('utf-8')
with zipfile.ZipFile(target, 'x', compression=zipfile.ZIP_DEFLATED) as archive:
    for relative, data in sorted(selected.items()):
        archive.writestr(f'bundle/skills/hallmark/{relative}', data)
    archive.writestr('bundle/skills/hallmark/NORI-IMPORT-PROVENANCE.json', provenance)
with zipfile.ZipFile(target) as archive:
    for relative, data in selected.items():
        assert archive.read(f'bundle/skills/hallmark/{relative}') == data
plan = inspector.inspect_archive(target)
assert len(plan['skills']) == 1 and plan['skills'][0]['name'] == 'hallmark'
assert plan['code_executed'] is False
assert hashlib.sha256(source.read_bytes()).hexdigest() == source_digest
print(json.dumps({'package': str(target), 'archive_sha256': plan['archive_sha256'],
    'original_archive_sha256': source_digest, 'original_files_preserved': len(selected),
    'expanded_bytes': sum(len(data) for data in selected.values()) + len(provenance),
    'compressed_bytes': target.stat().st_size, 'installed_inspector': 'passed',
    'installed': False, 'code_executed': False}, indent=2))
