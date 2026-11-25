import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repo = resolve(fileURLToPath(new URL('../../..', import.meta.url)))
const python = String.raw`
import importlib.util, json, pathlib, sys, types
import numpy as np
fake = types.ModuleType('kokoro_onnx')
fake.Kokoro = object
sys.modules['kokoro_onnx'] = fake
worker_path = pathlib.Path(sys.argv[1])
spec = importlib.util.spec_from_file_location('nori_kokoro_tts', worker_path)
worker = importlib.util.module_from_spec(spec)
spec.loader.exec_module(worker)
class Engine:
    def create_timed(self, text, **kwargs):
        self.received = (text, kwargs)
        return np.array([0.0, 0.25, -0.25]), 24000, None
engine = Engine()
valid = {'id':'test', 'text':'Hello.', 'expression':{'speed':1.03,'sentencePause':0.24,'clausePause':0.1,'pitch':1.04}}
result = worker.response(valid, engine)
assert result['id'] == 'test'
assert engine.received[1]['speed'] == 1.03
assert engine.received[1]['sentence_pause'] == 0.24
assert engine.received[1]['clause_pause'] == 0.1
for value in [True, 1.5, float('nan')]:
    bad = dict(valid, expression=dict(valid['expression'], speed=value))
    try: worker.response(bad, engine)
    except ValueError: pass
    else: raise AssertionError('invalid speed passed worker validation')
print(json.dumps({'worker':'pass','rendered_parameters':engine.received[1]}))
`

test('local Kokoro worker applies bounded cadence controls and rejects invalid values', () => {
  const result = spawnSync('python', ['-B', '-c', python, resolve(repo, 'apps/desktop/bridge/kokoro_tts.py')], {
    cwd: repo, encoding: 'utf8', timeout: 10000,
  })
  assert.equal(result.status, 0, result.stderr || result.stdout)
  assert.match(result.stdout, /"worker": "pass"/)
})
