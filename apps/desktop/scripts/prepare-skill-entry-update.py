"""Stage a one-file archive compatibility fix against the installed worker."""
import ast
import hashlib
import json
from pathlib import Path
import subprocess
import sys

root = Path(r'C:\Nori')
stage = root / '.work' / 'skill-archive-entry-update'
target = Path(r'C:\Program Files\Nori\resources\NoriSuite\nori\local_skill_installer.py')
old = target.read_bytes()
before = hashlib.sha256(old).hexdigest()
assert before == 'cb50a90aa1ab848f61b71562f37f682c3d83729636db13cd0670d41b9ca5c2bb'
source = (root / 'nori' / 'local_skill_installer.py').read_text(encoding='utf-8')
helper = source[source.index('def skill_archive_candidates('):source.index('def inspect_archive(')]
text = old.decode('utf-8')
start, end = text.index('def read_skill_archive_files('), text.index('def inspect_archive(')
text = text[:start] + helper + text[end:]
text = text.replace('import os\n', 'import os\nimport posixpath\n', 1)
text = text.replace('    files = read_skill_archive_files(archive_path)\n',
                    '    entry_sources = {}\n    files = read_skill_archive_files(archive_path, entry_sources=entry_sources)\n', 1)
start = text.index('    canonical = ', text.index('def inspect_archive('))
end = text.index('    if not 0 < len(candidates)', start)
text = text[:start] + '    candidates = skill_archive_candidates(files)\n' + text[end:]
text = text.replace("for title in ('LICENSE', 'NOTICE.md'):",
                    "for title in ('LICENSE', 'LICENSE.md', 'LICENSE.txt', 'COPYING', 'NOTICE.md'):")
text = text.replace("{'entry': entry, 'sha256': digest(files[entry])", "{'entry': entry_sources[entry], 'sha256': digest(files[entry])", 1)
ast.parse(text)
old_tree, new_tree = ast.parse(old.decode('utf-8')), ast.parse(text)
changed = {'read_skill_archive_files', 'inspect_archive'}
for node in old_tree.body:
    if isinstance(node, ast.FunctionDef) and node.name not in changed:
        other = next(n for n in new_tree.body if isinstance(n, ast.FunctionDef) and n.name == node.name)
        assert ast.dump(node) == ast.dump(other), node.name
stage.mkdir(exist_ok=False)
incoming = stage / 'local_skill_installer.py'
incoming.write_text(text, encoding='utf-8', newline='\n')
runner = '''import importlib.util,sys,unittest,nori,tempfile,time,json
from pathlib import Path
p=Path(sys.argv[1]);s=importlib.util.spec_from_file_location('nori.local_skill_installer',p)
m=importlib.util.module_from_spec(s);sys.modules[s.name]=m;nori.local_skill_installer=m;s.loader.exec_module(m)
suite=unittest.defaultTestLoader.loadTestsFromNames(['nori.tests.test_local_skill_installer','nori.tests.test_github_skill_intake'])
result=unittest.TextTestRunner(verbosity=2).run(suite)
if not result.wasSuccessful():sys.exit(1)
archive=Path(r'C:\\Users\\Studio\\Downloads\\remotion-main.zip')
t=time.perf_counter();plan=m.inspect_archive(archive)
assert len(plan['skills'])==12 and plan['code_executed'] is False
with tempfile.TemporaryDirectory(prefix='nori-remotion-import-test-') as directory:
 store=Path(directory)/'skills'
 installed=m.install_archive(archive,store,reviewed_plan_sha256=plan['plan_sha256'])
 catalog=m.catalog(store)
 assert installed['installed'] and catalog['verified'] and len(catalog['skills'])==12
 assert not any(p.is_symlink() for p in store.rglob('*'))
 assert all((store/'packages'/plan['archive_sha256']/s['name']/'LICENSE.md').is_file()for s in plan['skills'])
 print(json.dumps({'archive':'original remotion-main.zip','skills_verified':12,'files_verified':sum(len(s['files'])for s in plan['skills']),'temporary_store_only':True,'code_executed':False,'elapsed_seconds':round(time.perf_counter()-t,3)}))
hallmark=m.inspect_archive(Path(r'C:\\Users\\Studio\\Downloads\\hallmark-main.zip'))
assert [s['name']for s in hallmark['skills']]==['hallmark']
print('Original Hallmark ZIP regression: accepted')
'''
checked = subprocess.run([sys.executable, '-B', '-c', runner, str(incoming)], cwd=root,
    capture_output=True, text=True, timeout=90)
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
