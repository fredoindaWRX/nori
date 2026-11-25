import test from 'node:test'
import assert from 'node:assert/strict'
import { resolve, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { installationPaths, bridgeSettingsRoot, bridgeLearningPath } from '../bridge/installation-paths.mjs'

test('bridge roots follow the source installation even from another working directory', () => {
  const previous = process.cwd()
  try {
    process.chdir(process.env.SystemRoot ?? '/')
    const paths = installationPaths({})
    assert.equal(paths.noriRoot, resolve(import.meta.dirname, '..', '..', '..'))
    assert.equal(paths.ttsWorker, resolve(import.meta.dirname, '..', 'bridge', 'kokoro_tts.py'))
  } finally { process.chdir(previous) }
})

test('explicit suite and voice-worker overrides remain supported', () => {
  assert.deepEqual(installationPaths({ NORI_ROOT: 'custom-suite', NORI_TTS_WORKER: 'custom-worker' }), {
    noriRoot: 'custom-suite', ttsWorker: 'custom-worker',
  })
})
test('default bridge settings stay inside Nori; explicit existing settings override survives',()=>{
  const paths=installationPaths({})
  assert.equal(bridgeSettingsRoot({}),resolve(paths.noriRoot,'state','desktop','settings'))
  assert.equal(bridgeSettingsRoot({NORI_SETTINGS_DIR:'existing-settings'}),'existing-settings')
})

test('relocated packaged bridge keeps default settings under its own suite', () => {
  const suite = resolve('relocated-suite', 'resources', 'NoriSuite')
  const moduleUrl = pathToFileURL(resolve(suite, 'apps', 'desktop', 'bridge', 'installation-paths.mjs')).href
  assert.equal(installationPaths({}, moduleUrl).noriRoot, suite)
  assert.equal(bridgeSettingsRoot({}, moduleUrl), resolve(suite, 'state', 'desktop', 'settings'))
})

test('explicit Nori root also owns default bridge settings', () => {
  const suite = resolve('explicit-suite')
  assert.equal(bridgeSettingsRoot({ NORI_ROOT: suite }), resolve(suite, 'state', 'desktop', 'settings'))
})

test('learning storage follows settings and installation rather than user home or working directory',()=>{
  assert.equal(bridgeLearningPath({}),join(bridgeSettingsRoot({}),'learned-guidance.json'))
  assert.equal(bridgeLearningPath({NORI_SETTINGS_DIR:'existing-settings'}),join('existing-settings','learned-guidance.json'))
  assert.equal(bridgeLearningPath({NORI_ROOT:'explicit-suite'}),join(resolve('explicit-suite','state','desktop','settings'),'learned-guidance.json'))
  assert.equal(bridgeLearningPath({NORI_LEARNING_FILE:'isolated-learning.json',NORI_SETTINGS_DIR:'unused'}),'isolated-learning.json')
  const suite=resolve('relocated-suite','resources','NoriSuite')
  const moduleUrl=pathToFileURL(resolve(suite,'apps','desktop','bridge','installation-paths.mjs')).href
  assert.equal(bridgeLearningPath({},moduleUrl),join(suite,'state','desktop','settings','learned-guidance.json'))
})
