import test from 'node:test'
import assert from 'node:assert/strict'
import { validateSessionOutcome } from '../scripts/probe-desktop-session-outcome.mjs'

const originalPid = 4242
const modes = ['normal', 'startup-failure', 'native-exit']
const booleanFields = ['bootComplete', 'rendererReady', 'quitRequested', 'cleanupChecked',
  'cleanupVerified', 'ownershipChecked', 'ownershipReleased', 'failed',
  'successfulSession', 'guardianReleaseAuthorized']
const failureCodes = ['startup-failed', 'startup-cleanup-failed', 'native-service-exited',
  'native-exit-observation-failed', 'native-cleanup-failed', 'renderer-load-failed',
  'renderer-exited', 'probe-readiness-failed', 'desktop-cleanup-failed', 'ownership-release-failed']

function recordFor(mode) {
  const normal = mode === 'normal'
  const ready = mode !== 'startup-failure'
  return {
    rootPid: originalPid,
    desktop_session_outcome: {
      schema: 1,
      bootComplete: ready,
      rendererReady: ready,
      quitRequested: true,
      cleanupChecked: true,
      cleanupVerified: true,
      ownershipChecked: true,
      ownershipReleased: true,
      failed: !normal,
      failures: normal ? [] : [mode === 'startup-failure' ? 'startup-failed' : 'native-service-exited'],
      successfulSession: normal,
      outcome: normal ? 'clean' : 'failed',
      recommendedExitCode: normal ? 0 : 1,
      guardianReleaseAuthorized: false,
    },
  }
}

function rejectsMutation(mode, mutate) {
  const record = recordFor(mode)
  mutate(record.desktop_session_outcome, record)
  const before = structuredClone(record)
  assert.throws(() => validateSessionOutcome(record, mode, originalPid))
  assert.deepEqual(record, before, 'Rejected evidence must remain unmodified')
}

test('the pure validator accepts all three valid modes without mutating frozen evidence', () => {
  assert.equal(typeof validateSessionOutcome, 'function')
  for (const mode of modes) {
    const record = recordFor(mode)
    const before = structuredClone(record)
    Object.freeze(record.desktop_session_outcome.failures)
    Object.freeze(record.desktop_session_outcome)
    Object.freeze(record)
    assert.equal(validateSessionOutcome(record, mode, originalPid), record.desktop_session_outcome)
    assert.deepEqual(record, before)
  }
})

test('unknown modes and outcomes from a different original GUI PID are rejected', () => {
  for (const mode of [undefined, null, '', 'cancelled', 'NORMAL', 'normal ', {}, 0]) {
    assert.throws(() => validateSessionOutcome(recordFor('normal'), mode, originalPid), /Unknown.*mode/)
  }
  for (const mode of modes) {
    for (const pid of [undefined, null, originalPid + 1, String(originalPid), 0, -1]) {
      rejectsMutation(mode, (_state, record) => { record.rootPid = pid })
    }
  }
})

test('missing evidence and unsupported session schemas are rejected', () => {
  for (const record of [undefined, null, {}, { rootPid: originalPid },
    { rootPid: originalPid, desktop_session_outcome: null }]) {
    assert.throws(() => validateSessionOutcome(record, 'normal', originalPid))
  }
  for (const mode of modes) {
    for (const schema of [undefined, null, 0, 2, '1', true, {}, []]) {
      rejectsMutation(mode, state => { state.schema = schema })
    }
  }
})

test('every required boolean rejects missing and non-primitive boolean values', () => {
  for (const mode of modes) {
    for (const key of booleanFields) {
      rejectsMutation(mode, state => { delete state[key] })
      for (const value of [undefined, null, 0, 1, '', 'true', 'false', {}, [], new Boolean(true)]) {
        rejectsMutation(mode, state => { state[key] = value })
      }
    }
  }
})

test('health evidence cannot authorize an external guardian release in any mode', () => {
  for (const mode of modes) {
    rejectsMutation(mode, state => { state.guardianReleaseAuthorized = true })
  }
})

test('quit, verified physical cleanup and ordinary ownership release are mandatory in every mode', () => {
  for (const mode of modes) {
    for (const key of ['quitRequested', 'cleanupChecked', 'cleanupVerified',
      'ownershipChecked', 'ownershipReleased']) {
      rejectsMutation(mode, state => { state[key] = false })
    }
  }
})

test('mislabeled clean, failed, incomplete and cancelled states are refused', () => {
  for (const mode of modes) {
    const expected = mode === 'normal' ? 'clean' : 'failed'
    for (const outcome of ['clean', 'failed', 'incomplete', 'cancelled', undefined, 'unknown']) {
      if (outcome !== expected) rejectsMutation(mode, state => { state.outcome = outcome })
    }
    for (const key of ['failed', 'successfulSession', 'bootComplete', 'rendererReady']) {
      rejectsMutation(mode, state => { state[key] = !state[key] })
    }
    for (const exitCode of [undefined, null, '0', '1', -1, 2, mode === 'normal' ? 1 : 0]) {
      rejectsMutation(mode, state => { state.recommendedExitCode = exitCode })
    }
  }
})

test('the mode-specific fault must be present and normal completion must have no faults', () => {
  rejectsMutation('normal', state => { state.failures = ['startup-failed'] })
  for (const mode of ['startup-failure', 'native-exit']) {
    for (const failures of [[], ['renderer-exited'],
      [mode === 'startup-failure' ? 'native-service-exited' : 'startup-failed']]) {
      rejectsMutation(mode, state => { state.failures = failures })
    }
  }
})

test('failure arrays reject invalid shapes, oversized arrays and non-string or oversized entries', () => {
  for (const mode of ['startup-failure', 'native-exit']) {
    const expected = recordFor(mode).desktop_session_outcome.failures[0]
    const invalidFailures = [undefined, null, expected, {}, new Set([expected]),
      Array(11).fill(expected), [expected, 1], [expected, null], [expected, {}],
      [expected, []], [expected, 'x'.repeat(65)]]
    for (const failures of invalidFailures) {
      rejectsMutation(mode, state => { state.failures = failures })
    }
  }
})

test('distinct bounded additional faults are accepted in both fault modes', () => {
  for (const mode of ['startup-failure', 'native-exit']) {
    const record = recordFor(mode)
    record.desktop_session_outcome.failures = [...failureCodes]
    assert.equal(validateSessionOutcome(record, mode, originalPid), record.desktop_session_outcome)
  }
})

for (const mode of ['startup-failure', 'native-exit']) {
  test(`${mode} rejects duplicate failure codes`, () => {
    rejectsMutation(mode, state => { state.failures = [...state.failures, ...state.failures] })
  })

  test(`${mode} rejects failure codes outside the bounded taxonomy`, () => {
    for (const code of ['unknown-failure', 'STARTUP-FAILED', 'startup-failed ']) {
      rejectsMutation(mode, state => { state.failures = [...state.failures, code] })
    }
  })

  test(`${mode} rejects empty failure codes`, () => {
    rejectsMutation(mode, state => { state.failures = [...state.failures, ''] })
  })
}
