// Session health is separate from physical writer cleanup. This state is not
// authentication or authority to release an external retained-Job guardian.
const FAILURE_CODES = Object.freeze(['startup-failed', 'startup-cleanup-failed',
  'native-service-exited', 'native-exit-observation-failed', 'native-cleanup-failed',
  'renderer-load-failed', 'renderer-exited', 'probe-readiness-failed',
  'desktop-cleanup-failed', 'ownership-release-failed', 'microphone-owner-lost',
  'native-runtime-exited', 'native-runtime-exit-observation-failed',
  'gpt-oss-service-exited', 'gpt-oss-service-exit-observation-failed'])

function createDesktopSessionOutcome() {
  let bootComplete = false, rendererReady = false, quitRequested = false
  let cleanupChecked = false, cleanupVerified = false, ownershipChecked = false, ownershipReleased = false
  const failures = new Set()
  const fail = code => {
    if (!FAILURE_CODES.includes(code)) throw Error('Unknown bounded desktop failure code')
    failures.add(code)
  }
  const boolean = value => { if (typeof value !== 'boolean') throw Error('Explicit boolean outcome required') }
  const snapshot = () => {
    const failed = failures.size > 0
    const successfulSession = !failed && bootComplete && rendererReady && quitRequested &&
      cleanupChecked && cleanupVerified && ownershipChecked && ownershipReleased
    return Object.freeze({ schema: 1, bootComplete, rendererReady, quitRequested,
      cleanupChecked, cleanupVerified, ownershipChecked, ownershipReleased, failed,
      failures: Object.freeze([...failures]), successfulSession,
      outcome: failed ? 'failed' : successfulSession ? 'clean' :
        quitRequested && cleanupVerified && ownershipReleased ? 'cancelled' : 'incomplete',
      recommendedExitCode: failed ? 1 : 0, guardianReleaseAuthorized: false })
  }
  return Object.freeze({ fail, snapshot,
    bootCompleted() { if (quitRequested) return false; bootComplete = true; return true },
    rendererLoaded() { if (quitRequested) return false; rendererReady = true; return true },
    beginQuit() { quitRequested = true },
    cleanupCompleted(success) {
      boolean(success)
      if (!quitRequested) throw Error('Desktop cleanup requires a quit request')
      cleanupVerified = cleanupChecked ? cleanupVerified && success : success
      cleanupChecked = true
      if (!success) fail('desktop-cleanup-failed')
    },
    ownershipCompleted(success) {
      boolean(success)
      if (!cleanupChecked || !cleanupVerified) throw Error('Ownership outcome requires verified physical cleanup')
      ownershipReleased = ownershipChecked ? ownershipReleased && success : success
      ownershipChecked = true
      if (!success) fail('ownership-release-failed')
    },
  })
}
module.exports = { createDesktopSessionOutcome, FAILURE_CODES }
