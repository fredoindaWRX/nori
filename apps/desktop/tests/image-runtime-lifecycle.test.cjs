const test = require('node:test'), assert = require('node:assert/strict')
const {createImageRuntimeLifecycle} = require('../desktop/image-runtime-lifecycle.cjs')

function fixture({busy = false, failQueue = false} = {}) {
  let now = 0, alive = false
  const calls = []
  const life = createImageRuntimeLifecycle({clock: () => now, idleMs: 600_000,
    start: async () => { calls.push('start'); alive = true },
    stop: async () => { calls.push('stop'); alive = false },
    isOwnedAlive: () => alive,
    queueBusy: async () => { if (failQueue) throw Error('no answer'); return busy } })
  return {life, calls, advance: ms => { now += ms }, setBusy: value => { busy = value }, alive: () => alive}
}

test('nothing starts until an image or video request asks for it', async () => {
  const f = fixture()
  assert.equal(await f.life.tick(), 'none'); assert.deepEqual(f.calls, [])
  await Promise.all([f.life.request(), f.life.request()])
  assert.deepEqual(f.calls, ['start'], 'concurrent requests start it once')
})

test('it stops only after the idle window with an empty queue, then starts again on demand', async () => {
  const f = fixture()
  await f.life.request()
  f.advance(5 * 60_000); assert.equal(await f.life.tick(), 'recent')
  f.setBusy(true); f.advance(20 * 60_000); assert.equal(await f.life.tick(), 'busy', 'a running or queued job keeps it alive')
  f.setBusy(false); f.advance(9 * 60_000); assert.equal(await f.life.tick(), 'recent', 'the idle window restarts after the last busy moment')
  f.advance(2 * 60_000); assert.equal(await f.life.tick(), 'stopped'); assert.equal(f.alive(), false)
  await f.life.request(); assert.deepEqual(f.calls, ['start', 'stop', 'start'])
})

test('an unanswered queue check never stops the runtime', async () => {
  const f = fixture({failQueue: true})
  await f.life.request(); f.advance(60 * 60_000)
  assert.equal(await f.life.tick(), 'busy'); assert.equal(f.alive(), true)
})

test('invalid wiring is refused', () => {
  assert.throws(() => createImageRuntimeLifecycle({}), /requires/)
  assert.throws(() => createImageRuntimeLifecycle({start() {}, stop() {}, isOwnedAlive() {}, queueBusy() {}, idleMs: 1000}), /at least one minute/)
})
