import test from 'node:test'
import assert from 'node:assert/strict'
import { createSingleFlight } from '../src/lib/single-flight.ts'

test('overlapping startup callers share one microphone/wake initialization', async () => {
  const run = createSingleFlight()
  let finish
  let starts = 0
  const start = () => {
    starts++
    return new Promise(resolve => { finish = resolve })
  }

  const first = run(start)
  const second = run(start)
  assert.equal(starts, 0, 'startup is scheduled in a microtask')
  await Promise.resolve()
  assert.equal(starts, 1)
  const ready = { live: true }
  finish(ready)
  assert.equal(await first, ready)
  assert.equal(await second, ready)
})

test('a later attempt can recover after the previous startup fails', async () => {
  const run = createSingleFlight()
  let starts = 0
  await assert.rejects(run(async () => {
    starts++
    throw Error('microphone permission denied')
  }), /permission denied/)
  assert.deepEqual(await run(async () => {
    starts++
    return { live: true }
  }), { live: true })
  assert.equal(starts, 2)
})
