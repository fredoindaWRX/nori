import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { NORI_IDENTITY, NORI_PERSONA } from '../bridge/nori-identity.mjs'
const { appIdentity } = createRequire(import.meta.url)('../desktop/app-identity.cjs')
const { validateRunningIdentityPanel } = createRequire(import.meta.url)('../scripts/probe-packaged-consolidated.cjs')
const common = { suiteRoot: 'C:\\Nori', stateRoot: 'C:\\Nori\\state', version: '1.0.0', runtime: 'norllama', packaged: true }
test('identity labels actual executable, not selected release or environment secrets', () => {
  const result = appIdentity({ ...common, executable: 'C:\\Nori\\apps\\desktop\\release\\native-desktop-old-build\\win-unpacked\\Nori.exe', token: 'secret' })
  assert.equal(result.build, 'old-build')
  assert.equal(result.runtime, 'NorLlama · native runtime')
  assert.equal(JSON.stringify(result).includes('secret'), false)
  assert.equal(result.stateRoot, common.stateRoot)
})
test('one canonical soul and user-state continuity are protected by runtime identity', () => {
  const soul = readFileSync(new URL('../../../docs/NORI-SOUL.md', import.meta.url), 'utf8')
  assert.equal(NORI_IDENTITY.id, 'nori')
  assert.match(NORI_PERSONA, /one continuous desktop intelligence/)
  assert.match(NORI_PERSONA, /Remain the same Nori across code and skill updates/)
  assert.match(NORI_PERSONA, /do not clear or replace them unless the user explicitly asks/)
  assert.match(soul, /^# N\.O\.R\.I\. Soul/m)
  assert.match(soul, /conversation history, settings, installed skills/i)
  assert.match(soul, /SKILL\.md/)
})
test('installed and development paths are not mislabeled as selected native build', () => {
  assert.equal(appIdentity({ ...common, executable: 'C:\\Program Files\\Nori\\Nori.exe', runtime: 'ollama-rollback' }).build, 'Packaged build (label unavailable)')
  assert.match(appIdentity({ ...common, executable: 'electron.exe', packaged: false }).build, /Development/)
})

test('the imported local runtime is not falsely labeled as an Ollama rollback', () => {
  const result=appIdentity({...common,executable:'C:\\Program Files\\Nori\\Nori.exe',runtime:'gpt-oss'})
  assert.equal(result.runtime,'Nori · local imported-model runtime')
  assert.equal(result.suiteRoot,common.suiteRoot)
  assert.equal(result.stateRoot,common.stateRoot)
})

test('unrecognized runtime metadata is not silently labeled as a different backend', () => {
  for(const runtime of [undefined,'', 'unrecognized-test-backend','constructor','__proto__']) {
    assert.equal(appIdentity({...common,executable:'Nori.exe',runtime}).runtime,'Runtime unavailable or unrecognized')
  }
})
test('preload identity API invokes only its read-only identity channel', async () => {
  const exposed = {}, calls = []
  runInNewContext(readFileSync(new URL('../desktop/workspace-preload.cjs', import.meta.url), 'utf8'), {
    require: (name) => {
      assert.equal(name, 'electron')
      return { contextBridge: { exposeInMainWorld: (key, value) => { exposed[key] = value } },
        ipcRenderer: { sendSync: () => null, invoke: async (channel, ...args) => { calls.push([channel, args]); return { build: 'fixture' } } } }
    },
  })
  assert.equal((await exposed.noriInstall.identity()).build, 'fixture')
  assert.deepEqual(calls, [['nori:app:identity', []]])
})
test('packaged panel check rejects a stale executable or state folder', () => {
  const paths = { executable: 'C:\\Nori\\Nori.exe', suiteRoot: 'C:\\Nori\\suite', desktop: 'C:\\Nori\\state' }
  const text = `Which Nori is this? NorLlama · native runtime App: ${paths.executable} Suite: ${paths.suiteRoot} Saved state: ${paths.desktop}`
  assert.equal(validateRunningIdentityPanel({ renderer: { installation: { text } } }, paths), true)
  assert.throws(() => validateRunningIdentityPanel({ renderer: { installation: { text: text.replace(paths.executable, 'old.exe') } } }, paths))
  assert.throws(() => validateRunningIdentityPanel({ renderer: { installation: { text: text.replace(paths.desktop, 'old-state') } } }, paths))
  assert.throws(() => validateRunningIdentityPanel({}, paths))
})
