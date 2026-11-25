"""Stage one installed-worker patch, preserving newer provenance implementation."""
import ast
import hashlib
import importlib.util
import json
from pathlib import Path
import subprocess
import sys

root = Path(r'C:\Nori')
stage = root / '.work' / 'skill-archive-update'
target = Path(r'C:\Program Files\Nori\resources\NoriSuite\nori\local_skill_installer.py')
old = target.read_bytes()
before = hashlib.sha256(old).hexdigest()
assert before == '3fb3b59d15c87bb4007271a9c0b21daccb62a48b46e5cfa4b614cbaeaec71e6e'
source = (root / 'nori' / 'local_skill_installer.py').read_text(encoding='utf-8')
helper = source[source.index('def read_skill_archive_files('):source.index('def inspect_archive(')]
text = old.decode('utf-8')
assert 'def read_skill_archive_files(' not in text
text = text.replace('def inspect_archive(', helper + 'def inspect_archive(', 1)
start = text.index('    files, total = {}, 0', text.index('def inspect_archive('))
end = text.index('    if archive_path.stat().st_size != archive_bytes', start)
text = text[:start] + '    files = read_skill_archive_files(archive_path)\n' + text[end:]
ast.parse(text)
assert text.count('def validate_source_metadata(') == 1
assert text.count('GitHub package files do not match the pinned source manifest') == 1
stage.mkdir(exist_ok=False)
incoming = stage / 'local_skill_installer.py'
incoming.write_text(text, encoding='utf-8', newline='\n')
runner = '''import importlib.util,sys,unittest,nori
from pathlib import Path
p=Path(sys.argv[1]);s=importlib.util.spec_from_file_location('nori.local_skill_installer',p)
m=importlib.util.module_from_spec(s);sys.modules[s.name]=m;nori.local_skill_installer=m;s.loader.exec_module(m)
suite=unittest.defaultTestLoader.loadTestsFromName('nori.tests.test_local_skill_installer')
result=unittest.TextTestRunner(verbosity=2).run(suite)
if not result.wasSuccessful():sys.exit(1)
plan=m.inspect_archive(Path(r'C:\\Users\\Studio\\Downloads\\hallmark-main.zip'))
assert [s['name']for s in plan['skills']]==['hallmark']
assert plan['code_executed'] is False
print('Original full Hallmark ZIP: accepted; no package code executed')
'''
checked = subprocess.run([sys.executable, '-B', '-c', runner, str(incoming)], cwd=root,
    capture_output=True, text=True, timeout=60)
(stage / 'tests.log').write_text(checked.stdout + checked.stderr, encoding='utf-8')
assert checked.returncode == 0, checked.stdout + checked.stderr
assert target.read_bytes() == old
plan = {'schema': 'nori.skill-archive-code-update.v1', 'target': str(target), 'source': str(incoming),
    'before': before, 'after': hashlib.sha256(incoming.read_bytes()).hexdigest(),
    'protectedArchive': r'C:\Program Files\Nori\resources\app.asar',
    'protectedArchiveSha256': hashlib.sha256(Path(r'C:\Program Files\Nori\resources\app.asar').read_bytes()).hexdigest(),
    'testExitCode': checked.returncode, 'filesChanged': 1, 'installed': False}
(stage / 'plan.json').write_text(json.dumps(plan, indent=2), encoding='utf-8')
print(json.dumps(plan, indent=2))
