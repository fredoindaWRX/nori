"""Run disposable Aider contract fixtures against the installed suite modules."""
import importlib.util
import json
from pathlib import Path
import sys
import unittest

suite_root = Path(r'C:\Program Files\Nori\resources\NoriSuite')
sys.path.insert(0, str(suite_root))
if len(sys.argv) == 3 and sys.argv[1] == '--overlay':
    overlay = Path(sys.argv[2]).resolve()
    if overlay != Path(r'C:\Nori\.work\same-app-aider-contract-update').resolve():
        raise RuntimeError('Unexpected test overlay')
    import nori.development_workers
    for name, relative in (
        ('nori.development_workers.base', 'development_workers/base.py'),
        ('nori.development_workers.aider_adapter', 'development_workers/aider_adapter.py'),
        ('nori.nori_aider', 'nori_aider.py'),
    ):
        spec = importlib.util.spec_from_file_location(name, overlay / relative)
        module = importlib.util.module_from_spec(spec)
        sys.modules[name] = module
        spec.loader.exec_module(module)
        parent, attribute = name.rsplit('.', 1)
        setattr(sys.modules[parent], attribute, module)
import nori.nori_aider
import nori.development_workers.aider_adapter

for module in (nori.nori_aider, nori.development_workers.aider_adapter):
    if not Path(module.__file__).resolve().is_relative_to(overlay if 'overlay' in globals() else suite_root):
        raise RuntimeError('Test imported a module outside the installed suite')
print(json.dumps({'testScope': 'three-file overlay on installed suite' if 'overlay' in globals() else 'installed suite',
                  'modulePaths': [nori.nori_aider.__file__, nori.development_workers.aider_adapter.__file__]}), flush=True)
suite = unittest.TestSuite()
for name in ('test_nori_aider', 'test_aider_adapter'):
    path = Path(r'C:\Nori\nori\tests') / f'{name}.py'
    spec = importlib.util.spec_from_file_location(f'installed_acceptance_{name}', path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    suite.addTests(unittest.defaultTestLoader.loadTestsFromModule(module))
result = unittest.TextTestRunner(verbosity=2).run(suite)
print(json.dumps({'testsRun': result.testsRun, 'failures': len(result.failures),
                  'errors': len(result.errors), 'skipped': len(result.skipped),
                  'liveModelTested': False, 'testProjectsOnly': True}), flush=True)
raise SystemExit(0 if result.wasSuccessful() else 1)
