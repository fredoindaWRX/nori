import test from 'node:test'
import assert from 'node:assert/strict'
import { createIdleSelfTester } from '../bridge/idle-self-test.mjs'

const base = { dataRoot: 'C:/synthetic-unused', now: () => 10_000_000, lastActivityAt: () => 0,
  settings: () => ({ enabled: true, idleMinutes: 30, everyHours: 24 }), history: () => [] }

test('disabled and owner-active checks make no model request', async () => {
  const fetcher = () => { throw Error('must not fetch') }
  assert.equal(await createIdleSelfTester({ ...base, fetcher, settings: () => ({ enabled: false }) }).tick(), 'disabled')
  assert.equal(await createIdleSelfTester({ ...base, fetcher, lastActivityAt: base.now }).tick(), 'active')
})

test('pending model requests defer self-test', async () => {
  const tester = createIdleSelfTester({ ...base, fetcher: async () => Response.json({ data: [{ backend_profile: 'test', pending_requests: 1 }] }),
    run: () => { throw Error('must not run') } })
  assert.equal(await tester.tick(), 'busy')
})

test('concurrent ticks share readiness work and start only one self-test', async () => {
  let release, runs = 0, reads = 0
  const gate = new Promise(resolve => { release = resolve })
  const tester = createIdleSelfTester({ ...base, fetcher: async url => {
    reads++; await gate
    return Response.json({ data: url.endsWith('/v1/models') ? [{ backend_profile: 'test', pending_requests: 0 }] : [] })
  }, run: async function* () { runs++; yield 'done' } })
  const first = tester.tick(), second = tester.tick()
  release()
  assert.deepEqual(await Promise.all([first, second]), ['ran', 'ran'])
  assert.equal(runs, 1)
  assert.equal(reads, 2)
})

test('owner returning during readiness prevents self-test startup', async () => {
  let activity = 0, runs = 0
  const tester = createIdleSelfTester({ ...base, lastActivityAt: () => activity,
    fetcher: async url => {
      activity = base.now()
      return Response.json({ data: url.endsWith('/v1/models') ? [{ backend_profile: 'test' }] : [] })
    }, run: async function* () { runs++ } })
  assert.equal(await tester.tick(), 'active')
  assert.equal(runs, 0)
})

test('stop aborts pending readiness and prevents later ticks', async () => {
  let started, reads = 0
  const ready = new Promise(resolve => { started = resolve })
  const tester = createIdleSelfTester({ ...base, fetcher: async (_, { signal }) => {
    reads++; started()
    await new Promise((_, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }))
  } })
  const result = tester.tick(); await ready; tester.stop()
  assert.equal(await result, 'stopped')
  assert.equal(await tester.tick(), 'stopped')
  assert.equal(reads, 1)
})

test('stop cancels active self-test without reporting success', async () => {
  let started
  const ready = new Promise(resolve => { started = resolve })
  const tester = createIdleSelfTester({ ...base,
    fetcher: async url => Response.json({ data: url.endsWith('/v1/models') ? [{ backend_profile: 'test' }] : [] }),
    run: async function* ({ signal }) { started(); await new Promise((_, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true })) } })
  const result = tester.tick(); await ready; tester.stop()
  assert.equal(await result, 'aborted')
  assert.equal(tester.running, false)
})
