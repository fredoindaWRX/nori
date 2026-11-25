'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { createDesktopSessionOutcome, FAILURE_CODES } = require('../desktop/desktop-session-outcome.cjs')

const expectedFailureCodes = [
  'startup-failed',
  'startup-cleanup-failed',
  'native-service-exited',
  'native-exit-observation-failed',
  'native-cleanup-failed',
  'renderer-load-failed',
  'renderer-exited',
  'probe-readiness-failed',
  'desktop-cleanup-failed',
  'ownership-release-failed',
  'microphone-owner-lost',
  'native-runtime-exited',
  'native-runtime-exit-observation-failed',
  'gpt-oss-service-exited',
  'gpt-oss-service-exit-observation-failed',
]

function inspect(session) {
  const state = session.snapshot()
  assert.equal(Object.isFrozen(state), true)
  assert.equal(Object.isFrozen(state.failures), true)
  assert.equal(state.guardianReleaseAuthorized, false)
  assert.equal(state.failed, state.failures.length > 0)
  assert.equal(state.recommendedExitCode, state.failed ? 1 : 0)
  assert.equal(state.successfulSession, !state.failed && state.bootComplete && state.rendererReady &&
    state.quitRequested && state.cleanupChecked && state.cleanupVerified &&
    state.ownershipChecked && state.ownershipReleased)
  return state
}

function complete(session) {
  session.bootCompleted()
  session.rendererLoaded()
  session.beginQuit()
  session.cleanupCompleted(true)
  session.ownershipCompleted(true)
  return inspect(session)
}

test('a new session is explicitly incomplete and has no external guardian authority', () => {
  const session = createDesktopSessionOutcome()
  assert.equal(Object.isFrozen(session), true)
  assert.deepEqual(inspect(session), {
    schema: 1,
    bootComplete: false,
    rendererReady: false,
    quitRequested: false,
    cleanupChecked: false,
    cleanupVerified: false,
    ownershipChecked: false,
    ownershipReleased: false,
    failed: false,
    failures: [],
    successfulSession: false,
    outcome: 'incomplete',
    recommendedExitCode: 0,
    guardianReleaseAuthorized: false,
  })
})

test('success requires boot, renderer, quit, verified physical cleanup and ownership release', () => {
  const session = createDesktopSessionOutcome()
  const stages = [
    () => session.bootCompleted(),
    () => session.rendererLoaded(),
    () => session.beginQuit(),
    () => session.cleanupCompleted(true),
    () => session.ownershipCompleted(true),
  ]
  for (const [index, advance] of stages.entries()) {
    advance()
    const state = inspect(session)
    assert.equal(state.successfulSession, index === stages.length - 1)
    assert.equal(state.outcome, index === stages.length - 1 ? 'clean' : 'incomplete')
  }
  session.beginQuit()
  session.cleanupCompleted(true)
  session.ownershipCompleted(true)
  assert.equal(inspect(session).successfulSession, true)
})

test('verified cancellation stays distinct from an incomplete or successful session', () => {
  for (const [boot, renderer] of [[false, false], [true, false], [false, true], [true, true]]) {
    const session = createDesktopSessionOutcome()
    if (boot) session.bootCompleted()
    if (renderer) session.rendererLoaded()
    session.beginQuit()
    assert.equal(inspect(session).outcome, 'incomplete')
    session.cleanupCompleted(true)
    assert.equal(inspect(session).outcome, 'incomplete')
    session.ownershipCompleted(true)
    const state = inspect(session)
    assert.equal(state.successfulSession, boot && renderer)
    assert.equal(state.outcome, boot && renderer ? 'clean' : 'cancelled')
    assert.equal(state.recommendedExitCode, 0)
    assert.deepEqual(state.failures, [])
  }
})

test('cleanup and ownership reject out-of-order reports without mutating the session', () => {
  const session = createDesktopSessionOutcome()
  let before = inspect(session)
  for (const success of [true, false]) {
    assert.throws(() => session.cleanupCompleted(success), /requires a quit request/)
    assert.throws(() => session.ownershipCompleted(success), /requires verified physical cleanup/)
    assert.deepEqual(inspect(session), before)
  }
  session.beginQuit()
  before = inspect(session)
  for (const success of [true, false]) {
    assert.throws(() => session.ownershipCompleted(success), /requires verified physical cleanup/)
    assert.deepEqual(inspect(session), before)
  }
  session.cleanupCompleted(false)
  before = inspect(session)
  for (const success of [true, false]) {
    assert.throws(() => session.ownershipCompleted(success), /requires verified physical cleanup/)
    assert.deepEqual(inspect(session), before)
  }
})

test('each bounded failure stays fatal before readiness and after an otherwise clean session', () => {
  assert.deepEqual(FAILURE_CODES, expectedFailureCodes)
  assert.equal(Object.isFrozen(FAILURE_CODES), true)
  for (const code of expectedFailureCodes) {
    for (const late of [false, true]) {
      const session = createDesktopSessionOutcome()
      if (late) assert.equal(complete(session).outcome, 'clean')
      session.fail(code)
      session.fail(code)
      complete(session)
      const state = inspect(session)
      assert.equal(state.outcome, 'failed', code)
      assert.equal(state.successfulSession, false, code)
      assert.equal(state.recommendedExitCode, 1, code)
      assert.deepEqual(state.failures, [code])
    }
  }
})

test('multiple failures remain bounded, ordered and deduplicated after positive reports', () => {
  const session = createDesktopSessionOutcome()
  for (const code of expectedFailureCodes) session.fail(code)
  for (const code of [...expectedFailureCodes].reverse()) session.fail(code)
  const state = complete(session)
  assert.deepEqual(state.failures, expectedFailureCodes)
  assert.equal(state.outcome, 'failed')
})

test('delayed positive boot and renderer callbacks cannot upgrade readiness after quit', async () => {
  for (const [boot, renderer] of [[false, false], [true, false], [false, true], [true, true]]) {
    const session = createDesktopSessionOutcome()
    if (boot) assert.equal(session.bootCompleted(), true)
    if (renderer) assert.equal(session.rendererLoaded(), true)
    const delayedBoot = Promise.resolve().then(() => session.bootCompleted())
    const delayedRenderer = Promise.resolve().then(() => session.rendererLoaded())
    session.beginQuit()
    assert.deepEqual(await Promise.all([delayedBoot, delayedRenderer]), [false, false])
    const quitting = inspect(session)
    assert.equal(quitting.bootComplete, boot)
    assert.equal(quitting.rendererReady, renderer)
    session.cleanupCompleted(true)
    session.ownershipCompleted(true)
    const settled = inspect(session)
    assert.equal(session.bootCompleted(), false)
    assert.equal(session.rendererLoaded(), false)
    assert.deepEqual(inspect(session), settled)
    assert.equal(settled.outcome, boot && renderer ? 'clean' : 'cancelled')
  }
})

test('snapshots are immutable copies and cannot alter historical state or guardian authority', () => {
  const session = createDesktopSessionOutcome()
  const initial = inspect(session)
  const repeated = inspect(session)
  assert.notEqual(initial, repeated)
  assert.notEqual(initial.failures, repeated.failures)
  assert.throws(() => { initial.bootComplete = true }, TypeError)
  assert.throws(() => { initial.guardianReleaseAuthorized = true }, TypeError)
  assert.throws(() => initial.failures.push('startup-failed'), TypeError)
  assert.throws(() => { session.snapshot = () => ({ successfulSession: true }) }, TypeError)
  assert.throws(() => FAILURE_CODES.push('unbounded-failure'), TypeError)
  session.bootCompleted()
  session.fail('renderer-load-failed')
  const failed = inspect(session)
  assert.equal(initial.bootComplete, false)
  assert.equal(initial.failed, false)
  assert.deepEqual(initial.failures, [])
  assert.equal(failed.bootComplete, true)
  assert.deepEqual(failed.failures, ['renderer-load-failed'])
  assert.throws(() => { failed.failures[0] = 'startup-failed' }, TypeError)
  session.fail('native-service-exited')
  assert.deepEqual(failed.failures, ['renderer-load-failed'])
  assert.deepEqual(inspect(session).failures, ['renderer-load-failed', 'native-service-exited'])
})

test('unrecognized failure codes reject without coercion or state mutation', () => {
  const session = createDesktopSessionOutcome()
  session.fail('startup-failed')
  const before = inspect(session)
  const invalidCodes = [undefined, null, '', 'unknown', 'startup-failed ', 'STARTUP-FAILED',
    'startup-failed\n', 0, 1, true, false, {}, [], ['startup-failed'],
    new String('startup-failed'), Symbol('startup-failed')]
  for (const code of invalidCodes) {
    assert.throws(() => session.fail(code), /Unknown bounded desktop failure code/)
    assert.deepEqual(inspect(session), before)
  }
})

test('cleanup and ownership require explicit primitive booleans without mutating on rejection', () => {
  const invalidBooleans = [undefined, null, 0, 1, -1, NaN, '', 'true', 'false',
    {}, [], [true], new Boolean(true), new Boolean(false), Symbol('true')]
  const session = createDesktopSessionOutcome()
  session.beginQuit()
  let before = inspect(session)
  for (const value of invalidBooleans) {
    assert.throws(() => session.cleanupCompleted(value), /Explicit boolean outcome required/)
    assert.deepEqual(inspect(session), before)
  }
  session.cleanupCompleted(true)
  before = inspect(session)
  for (const value of invalidBooleans) {
    assert.throws(() => session.ownershipCompleted(value), /Explicit boolean outcome required/)
    assert.deepEqual(inspect(session), before)
  }
  session.ownershipCompleted(true)
  assert.equal(inspect(session).outcome, 'cancelled')
})

test('physical cleanup failure is monotonic and prevents later ownership reports', () => {
  for (const initiallySuccessful of [false, true]) {
    const session = createDesktopSessionOutcome()
    session.bootCompleted()
    session.rendererLoaded()
    session.beginQuit()
    if (initiallySuccessful) session.cleanupCompleted(true)
    session.cleanupCompleted(false)
    for (const report of [true, false, true]) {
      session.cleanupCompleted(report)
      const state = inspect(session)
      assert.equal(state.cleanupChecked, true)
      assert.equal(state.cleanupVerified, false)
      assert.equal(state.ownershipChecked, false)
      assert.equal(state.outcome, 'failed')
      assert.deepEqual(state.failures, ['desktop-cleanup-failed'])
      assert.throws(() => session.ownershipCompleted(true), /requires verified physical cleanup/)
      assert.throws(() => session.ownershipCompleted(false), /requires verified physical cleanup/)
    }
  }
})

test('ownership failure is monotonic even when cleanup and ownership later report success', () => {
  for (const initiallySuccessful of [false, true]) {
    const session = createDesktopSessionOutcome()
    session.bootCompleted()
    session.rendererLoaded()
    session.beginQuit()
    session.cleanupCompleted(true)
    if (initiallySuccessful) session.ownershipCompleted(true)
    session.ownershipCompleted(false)
    for (const report of [true, false, true]) {
      session.cleanupCompleted(true)
      session.ownershipCompleted(report)
      const state = inspect(session)
      assert.equal(state.cleanupVerified, true)
      assert.equal(state.ownershipChecked, true)
      assert.equal(state.ownershipReleased, false)
      assert.equal(state.outcome, 'failed')
      assert.deepEqual(state.failures, ['ownership-release-failed'])
    }
  }
})

test('a later cleanup failure also revokes clean status after ownership was released', () => {
  const session = createDesktopSessionOutcome()
  assert.equal(complete(session).outcome, 'clean')
  session.cleanupCompleted(false)
  session.cleanupCompleted(true)
  const state = inspect(session)
  assert.equal(state.cleanupVerified, false)
  assert.equal(state.successfulSession, false)
  assert.equal(state.outcome, 'failed')
  assert.deepEqual(state.failures, ['desktop-cleanup-failed'])
  assert.throws(() => session.ownershipCompleted(true), /requires verified physical cleanup/)
})
