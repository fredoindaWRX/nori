const test = require('node:test')
const assert = require('node:assert/strict')
const { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync } = require('node:fs')
const { resolve, join } = require('node:path')
const { createHash } = require('node:crypto')
const { performance } = require('node:perf_hooks')
const { startNativeStack } = require('../desktop/native-stack.cjs')

// Deliberately separate from ordinary discovery: this loads the real GPU model
// fifty times, but never opens the owner's profile or enables sensor capture.
test('50 real native Core/runtime lifecycle cycles preserve isolated memory and drain owned processes', {
  skip: process.platform !== 'win32' || process.env.NORI_REAL_LIFECYCLE_SOAK !== '1',
  timeout: 1200000,
}, async t => {
  const root = resolve(__dirname, '../../..')
  const verification = join(root, 'verification')
  mkdirSync(verification, { recursive: true })
  const trial = mkdtempSync(join(verification, '.native-lifecycle-soak-'))
  const state = join(trial, 'synthetic-state')
  const receiptPath = join(trial, 'lifecycle-receipt.json')
  const files = ['apps/desktop/desktop/native-stack.cjs', 'apps/desktop/desktop/native-core.cjs',
    'apps/desktop/desktop/native-service.cjs', 'nori/main.py', 'nori/core_lifecycle.py',
    'runtime/norllama/norllama.py', 'apps/desktop/tests/native-lifecycle-soak.test.cjs']
  const hashes = () => Object.fromEntries(files.map(file => [file,
    createHash('sha256').update(readFileSync(join(root, file))).digest('hex')]))
  const initialHashes = hashes()
  const receipt = { schema: 1, scope: 'source native Core/runtime; synthetic memory; real model startup',
    requiredCycles: 50, completedCycles: 0, passed: false, cycles: [], sourceHashes: initialHashes,
    sensorsUsed: false, ownerProfileUsed: false, installedAcceptanceVerified: false,
    wholeSystemAcceptanceVerified: false, startedAt: new Date().toISOString() }
  let stack, memoryId
  const alive = pid => { try { process.kill(pid, 0); return true } catch { return false } }
  async function request(operation) {
    const response = await fetch(`http://127.0.0.1:${stack.status.ports.merovingian}/task`, {
      method: 'POST', headers: { Authorization: `Bearer ${stack.environment.NORI_API_TOKEN}`,
        'Content-Type': 'application/json' }, body: JSON.stringify(operation),
      redirect: 'error', signal: AbortSignal.timeout(5000) })
    assert.equal(response.status, 200)
    return response.json()
  }
  try {
    for (let cycle = 1; cycle <= receipt.requiredCycles; cycle++) {
      const start = performance.now()
      stack = await startNativeStack({ root, dataRoot: state,
        environment: { ...process.env, NORI_INFERENCE_RUNTIME: 'norllama', NORI_ALLOW_WRITES: '0' } })
      assert.equal(stack.status.taskExecutionQualified, false)
      assert.equal(Object.keys(stack.status.ports).length, 12)
      const startupMs = performance.now() - start
      const ids = [stack.core.child.pid, stack.runtime.child.pid, stack.runtime.status.workerPid]
      assert.ok(ids.every(pid => Number.isSafeInteger(pid) && pid > 0))
      if (cycle === 1) {
        const remembered = await request({ operation: 'remember', scope: 'lifecycle-soak-fixture',
          content: 'Synthetic fifty-cycle persistence marker' })
        assert.equal(remembered.storage.backend, 'nori-sqlite')
        memoryId = remembered.entry.id
      }
      const recalled = await request({ operation: 'recall', scope: 'lifecycle-soak-fixture' })
      assert.deepEqual(recalled.entries.map(entry => entry.id), [memoryId])
      const unauthenticated = await fetch(`http://127.0.0.1:${stack.status.ports.merovingian}/task`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
        redirect: 'error', signal: AbortSignal.timeout(5000) })
      assert.equal(unauthenticated.status, 401)
      const shutdownStart = performance.now()
      await stack.stop(); await stack.exited
      const remaining = ids.filter(alive)
      assert.deepEqual(remaining, [])
      assert.equal(existsSync(join(state, '.nori-state-owner.json')), false)
      stack = null
      receipt.cycles.push({ cycle, startupMs, shutdownMs: performance.now() - shutdownStart,
        memoryRestored: true, unauthenticatedRequestDenied: true, ownedProcessesRemaining: remaining })
      receipt.completedCycles = cycle
      writeFileSync(receiptPath, JSON.stringify(receipt, null, 2))
      t.diagnostic(`Lifecycle ${cycle}/50 passed; startup ${startupMs.toFixed(0)} ms`)
    }
    assert.deepEqual(hashes(), initialHashes, 'Covered source files changed during the run')
    receipt.coveredSourceUnchanged = true
    receipt.passed = true
  } finally {
    if (stack) await stack.stop()
    receipt.finishedAt = new Date().toISOString()
    writeFileSync(receiptPath, JSON.stringify(receipt, null, 2))
    t.diagnostic(`Evidence: ${receiptPath}`)
  }
})
