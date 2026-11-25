import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { contained, safeDestination, refuseDifferentFile } from '../scripts/consolidate-local-tts.mjs'
import voicePaths from '../desktop/voice-paths.cjs'

test('voice consolidation rejects escape paths and refuses differing owner files', () => {
  const root = mkdtempSync(join(tmpdir(), 'nori-voice-copy-'))
  try {
    const source = join(root, 'source'), target = join(root, 'target')
    writeFileSync(source, 'recovery'); writeFileSync(target, 'owner')
    assert.equal(contained(root, root), false)
    assert.equal(contained(root, join(root, '..', 'outside')), false)
    assert.throws(() => safeDestination(root, join(root, '..', 'outside')), /escapes/)
    assert.throws(() => refuseDifferentFile(source, target), /Preserving/)
    writeFileSync(target, 'recovery')
    assert.doesNotThrow(() => refuseDifferentFile(source, target))
    assert.doesNotThrow(() => safeDestination(root, join(root, 'new', 'model')))
  } finally { rmSync(root, { recursive: true, force: true }) }
})
test('speech uses canonical runtime/models/worker paths with isolated Python arguments', () => {
  const root = join(tmpdir(), 'nori-fixture-suite')
  const paths = voicePaths.localVoicePaths(root, {})
  for (const path of [paths.python, paths.launcher, paths.worker, paths.model, paths.voices])
    assert.equal(contained(root, path), true)
  assert.ok(paths.worker.includes(join('apps', 'desktop', 'bridge')))
  assert.ok(paths.model.includes(join('models', 'voice')))
  assert.deepEqual(paths.args, ['-I', '-B', paths.launcher, '--kokoro', paths.worker, paths.model, paths.voices])
  assert.ok(!JSON.stringify(paths).includes('NoriV2'))
})
