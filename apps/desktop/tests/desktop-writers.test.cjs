const test = require('node:test')
const assert = require('node:assert/strict')
const { EventEmitter } = require('node:events')
const { drainDesktopWriters, onceDesktopShutdown } = require('../desktop/desktop-writers.cjs')
function child(exit = true) {
  const value = new EventEmitter()
  Object.assign(value, { pid: 12345, exitCode: null, signalCode: null, killed: false, killCount: 0 })
  value.kill = () => {
    value.killed = true; value.killCount++
    if (exit) queueMicrotask(() => { value.exitCode = 0; value.emit('exit', 0) })
  }
  return value
}
test('repeated quit requests join one cleanup and cannot run concurrent drains', async () => {
  let calls = 0, release
  const shutdown = onceDesktopShutdown(() => { calls++; return new Promise(resolve => { release = resolve }) })
  const first = shutdown(), second = shutdown()
  assert.equal(first, second)
  await Promise.resolve()
  assert.equal(calls, 1)
  release('drained')
  assert.equal(await first, 'drained')
  assert.equal(shutdown(), first)
  assert.equal(calls, 1)
})
test('failed cleanup is retained across subsequent quit requests', async () => {
  let calls = 0
  const shutdown = onceDesktopShutdown(() => { calls++; throw Error('fixture failure') })
  const first = shutdown()
  await assert.rejects(first, /fixture failure/)
  assert.equal(shutdown(), first)
  await assert.rejects(shutdown(), /fixture failure/)
  assert.equal(calls, 1)
})
test('desktop drain waits for actual child exit and deduplicates exact identities', async () => {
  const writer = child()
  assert.deepEqual(await drainDesktopWriters([writer, writer, null]), {
    ownedWritersDrained: true, unmanagedWriterQuiescenceVerified: false })
  assert.equal(writer.killCount, 1)
  assert.equal(writer.listenerCount('exit'), 0)
  assert.equal(writer.listenerCount('error'), 0)
})
test('a prior kill request does not make a live writer quiescent', async () => {
  const writer = child(false)
  writer.killed = true
  await assert.rejects(drainDesktopWriters([writer], { timeoutMs: 10 }), /deadline/)
  assert.equal(writer.killCount, 0)
  assert.equal(writer.listenerCount('exit'), 0)
})
test('exited and failed-to-spawn children need no new termination', async () => {
  const writer = child(false); writer.exitCode = 0
  const missing = child(false); missing.pid = undefined; missing.startupError = Error('fixture')
  await drainDesktopWriters([writer, missing])
  assert.equal(writer.killCount + missing.killCount, 0)
})
test('unknown child errors and invalid timeouts fail closed', async () => {
  const writer = child(false)
  const pending = drainDesktopWriters([writer], { timeoutMs: 100 })
  writer.emit('error', Error('private fixture detail'))
  await assert.rejects(pending, /cleanup failed/)
  for (const timeoutMs of [0, 30001, 1.5]) await assert.rejects(drainDesktopWriters([], { timeoutMs }), /Invalid/)
})
