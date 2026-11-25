import test from 'node:test'
import assert from 'node:assert/strict'
import { createWakeRetrySchedule } from '../src/lib/wake-retry-schedule.ts'

function fakeTimers() {
  const jobs = []
  return {
    jobs,
    schedule(callback, delayMs) {
      const job = { callback, delayMs, cancelled: false }
      jobs.push(job)
      return job
    },
    cancel(job) { job.cancelled = true },
  }
}

test('transient wake startup failures retry with bounded backoff and reset after recovery', () => {
  const timers = fakeTimers()
  const retry = createWakeRetrySchedule({ ...timers, delays: [20, 50] })
  let attempts = 0

  assert.equal(retry.scheduleRetry('transient', () => { attempts++ }), true)
  assert.equal(retry.scheduleRetry('transient', () => { attempts++ }), false, 'only one timer is queued')
  assert.equal(timers.jobs[0].delayMs, 20)
  timers.jobs[0].callback()
  assert.equal(attempts, 1)

  retry.scheduleRetry('unavailable', () => { attempts++ })
  assert.equal(timers.jobs[1].delayMs, 50)
  timers.jobs[1].callback()
  assert.equal(attempts, 2)

  retry.reset()
  retry.scheduleRetry('transient', () => { attempts++ })
  assert.equal(timers.jobs[2].delayMs, 20)
})

test('permission denial never schedules an automatic retry', () => {
  const timers = fakeTimers()
  const retry = createWakeRetrySchedule(timers)
  assert.equal(retry.scheduleRetry('permission-denied', () => assert.fail('must not prompt again')), false)
  assert.equal(timers.jobs.length, 0)
})

test('stopping wake retries cancels pending work and prevents future scheduling', () => {
  const timers = fakeTimers()
  const retry = createWakeRetrySchedule(timers)
  let attempts = 0
  retry.scheduleRetry('transient', () => { attempts++ })
  retry.stop()
  assert.equal(timers.jobs[0].cancelled, true)
  timers.jobs[0].callback()
  assert.equal(attempts, 0)
  assert.equal(retry.scheduleRetry('transient', () => { attempts++ }), false)
})
