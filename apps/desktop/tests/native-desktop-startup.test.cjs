const test = require('node:test')
const assert = require('node:assert/strict')
const { startNativeDesktop, clearUnavailableRuntimeCredentials, nativeCoreEndpoint } = require('../desktop/native-desktop-startup.cjs')

test('explicitly pending model opens desktop without a runtime or replacement', async () => {
  let calls = 0
  const result = await startNativeDesktop({}, { allowUnavailable: true, start: async () => {
    calls++; throw Object.assign(new Error('pending'), { code: 'NORI_MODEL_UNAVAILABLE' })
  } })
  assert.equal(result, null); assert.equal(calls, 1)
})
test('qualification and ordinary runtime errors remain fatal', async () => {
  for (const [allowUnavailable, code] of [[false, 'NORI_MODEL_UNAVAILABLE'], [true, 'NORI_OWNED_CLEANUP_FAILED'], [true, 'OTHER']]) {
    const failure = Object.assign(new Error('failed'), { code })
    await assert.rejects(startNativeDesktop({}, { allowUnavailable, start: async () => { throw failure } }), error => error === failure)
  }
})
test('healthy stack is preserved and pending mode removes borrowed credentials and writes', async () => {
  const stack = { status: { modelId: 'nori-20b-son' } }
  assert.equal(await startNativeDesktop({}, { start: async () => stack }), stack)
  const env = { NORI_RUNTIME_API_KEY: 'fixture', NORI_RUNTIME_MODEL_ID: 'other', NORI_RUNTIME_URL: 'fixture', NORI_API_TOKEN: 'fixture',
    NORI_COUNCIL_URL: 'http://127.0.0.1:5151', NORI_NATIVE_CORE_READY: '1', NORI_NATIVE_TOOLS_QUALIFIED: '1', NORI_ALLOW_WRITES: '1', KEEP: 'yes' }
  clearUnavailableRuntimeCredentials(env)
  assert.deepEqual(env, { NORI_ALLOW_WRITES: '0', KEEP: 'yes' })
})

test('bridge uses the exact readiness-bound Core endpoint rather than the legacy fixed port', () => {
  assert.equal(nativeCoreEndpoint({ environment: { NORI_COUNCIL_URL: 'http://127.0.0.1:54001' } }, 'http://127.0.0.1:19107'),
    'http://127.0.0.1:54001')
  assert.equal(nativeCoreEndpoint(null, 'http://127.0.0.1:19107'), 'http://127.0.0.1:19107')
  for (const value of ['https://127.0.0.1:54001', 'http://example.com:54001', 'http://127.0.0.1:0', 'http://user:pass@127.0.0.1:54001']) {
    assert.throws(() => nativeCoreEndpoint({ environment: { NORI_COUNCIL_URL: value } }, 'http://127.0.0.1:19107'), /loopback|invalid/)
  }
})
