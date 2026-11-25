import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
const program = fileURLToPath(new URL('../norama-generate.exe', import.meta.url))
test('generation CLI rejects invalid bounds/options before loading a model or touching GPU', () => {
  for (const bound of ['0', '17', '-1', 'bad', '4294967296']) {
    const result = spawnSync(program, ['missing.gguf', bound, 'hi'], { encoding: 'utf8', timeout: 3000, windowsHide: true })
    assert.notEqual(result.status, 0); assert.match(result.stderr, /generation bound/)
    assert.doesNotMatch(result.stderr, /cannot open model|CUDA/)
  }
  const invalid = spawnSync(program, ['missing.gguf', '1', 'hi', '--other'], { encoding: 'utf8', timeout: 3000, windowsHide: true })
  assert.notEqual(invalid.status, 0); assert.match(invalid.stderr, /unknown generation option/)
})
