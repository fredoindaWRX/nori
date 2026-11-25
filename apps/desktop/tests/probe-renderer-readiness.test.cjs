const test = require('node:test')
const assert = require('node:assert/strict')
const { inspectProbeRenderer } = require('../desktop/probe-renderer-readiness.cjs')
test('renderer readiness inspection returns actual renderer result', async () => {
  const window = { isDestroyed: () => false, webContents: { executeJavaScript: async () => ({ model: 'local' }) } }
  assert.deepEqual(await inspectProbeRenderer(window, 'synthetic'), { model: 'local' })
})
test('closed renderer is rejected without executing inspection', async () => {
  let ran = false
  const window = { isDestroyed: () => true, webContents: { executeJavaScript: () => { ran = true } } }
  await assert.rejects(inspectProbeRenderer(window, 'synthetic'), /window closed/)
  assert.equal(ran, false)
})
test('unresponsive renderer reports a bounded specific failure', async () => {
  const window = { isDestroyed: () => false, webContents: { executeJavaScript: () => new Promise(() => {}) } }
  await assert.rejects(inspectProbeRenderer(window, 'synthetic', { timeoutMs: 20 }), /inspection timed out/)
})
test('renderer errors remain failures', async () => {
  const window = { isDestroyed: () => false, webContents: { executeJavaScript: async () => { throw Error('renderer failed') } } }
  await assert.rejects(inspectProbeRenderer(window, 'synthetic'), /renderer failed/)
})
