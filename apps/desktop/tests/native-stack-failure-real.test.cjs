const test = require('node:test')
const assert = require('node:assert/strict')
const { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } = require('node:fs')
const { resolve, join } = require('node:path')
const { createHash } = require('node:crypto')
const { startNativeStack } = require('../desktop/native-stack.cjs')

const enabled = process.platform === 'win32' && process.env.NORI_REAL_FAILURE_TEST === '1'
const sourceRoot = resolve(__dirname, '../../..')
const candidate = process.env.NORI_STACK_TEST_CANDIDATE
if (candidate !== undefined && !/^[a-z0-9][a-z0-9-]{0,63}$/.test(candidate)) throw Error('Invalid failure test candidate')
const root = candidate === undefined ? sourceRoot : join(sourceRoot,
  `apps/desktop/release/native-desktop-${candidate}/win-unpacked/resources/NoriSuite`)
const environment = { ...process.env, NORI_INFERENCE_RUNTIME: 'norllama', NORI_ALLOW_WRITES: '0' }
const sourceFiles = ['apps/desktop/desktop/native-stack.cjs', 'apps/desktop/desktop/native-core.cjs',
  'apps/desktop/desktop/native-service.cjs', 'nori/main.py', 'nori/core_lifecycle.py',
  'runtime/norllama/norllama.py', 'apps/desktop/bridge/native-runtime.mjs',
  'apps/desktop/tests/native-stack-failure-real.test.cjs']
const hashes = () => Object.fromEntries([
  ...sourceFiles.map(file => [file, createHash('sha256').update(readFileSync(join(sourceRoot, file))).digest('hex')]),
  ...['nori/main.py', 'nori/core_lifecycle.py', 'runtime/norllama/norllama.py'].map(file =>
    [`exercised-suite/${file}`, createHash('sha256').update(readFileSync(join(root, file))).digest('hex')]),
])
const alive = pid => { try { process.kill(pid, 0); return true } catch { return false } }
const ownedIds = stack => [stack.core.child.pid, stack.runtime.child.pid, stack.runtime.status.workerPid]
function isolatedTrial(prefix) {
  const verification = join(root, 'verification')
  mkdirSync(verification, { recursive: true })
  return mkdtempSync(join(verification, prefix))
}
async function bounded(promise, ms) {
  let timer
  try { return await Promise.race([promise, new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error('Owned failure response exceeded deadline')), ms)
  })]) } finally { clearTimeout(timer) }
}
async function memoryTask(stack, body) {
  const response = await fetch(`http://127.0.0.1:${stack.status.ports.merovingian}/task`, {
    method: 'POST', headers: { Authorization: `Bearer ${stack.environment.NORI_API_TOKEN}`,
      'Content-Type': 'application/json' }, body: JSON.stringify(body),
    redirect: 'error', signal: AbortSignal.timeout(5000) })
  assert.equal(response.status, 200)
  return response.json()
}
function assertDrained(ids, state) {
  assert.ok(ids.every(pid => Number.isSafeInteger(pid) && pid > 0))
  assert.deepEqual(ids.filter(alive), [])
  assert.equal(existsSync(join(state, '.nori-state-owner.json')), false)
}
async function gracefulStop(stack, state) {
  const ids = ownedIds(stack)
  await stack.stop(); await stack.exited
  const coreExit = await stack.core.exited, runtimeExit = await stack.runtime.exited
  assert.equal(coreExit.code, 0)
  assert.equal(runtimeExit.code, 0)
  assert.equal(coreExit.exitSignal, null)
  assert.equal(runtimeExit.exitSignal, null)
  assertDrained(ids, state)
  return { coreExit, runtimeExit, ownedProcessesRemaining: [] }
}

test('real native stack gracefully shuts down with zero Core/runtime exit codes', {
  skip: !enabled, timeout: 90000,
}, async t => {
  const trial = isolatedTrial('.native-graceful-real-'), state = join(trial, 'synthetic-state')
  const initialHashes = hashes()
  let stack
  try {
    stack = await startNativeStack({ root, dataRoot: state, environment })
    assert.equal(stack.status.sensorsEnabled, 0)
    const result = await gracefulStop(stack, state)
    stack = null
    assert.deepEqual(hashes(), initialHashes)
    const receipt = join(trial, 'graceful-receipt.json')
    writeFileSync(receipt, JSON.stringify({ passed: true, ...result, sourceHashes: initialHashes,
      coveredSourceUnchanged: true, ownerProfileUsed: false, sensorsUsed: false,
      installedAcceptanceVerified: false, wholeSystemAcceptanceVerified: false }, null, 2))
    t.diagnostic(`Evidence: ${receipt}`)
  } finally { if (stack) await stack.stop() }
})

for (const component of ['core', 'runtime', 'worker']) {
  test(`real ${component} process loss fails closed and explicitly restarts from preserved synthetic memory`, {
    skip: !enabled, timeout: 120000,
  }, async t => {
    const trial = isolatedTrial(`.native-${component}-loss-real-`), state = join(trial, 'synthetic-state')
    const initialHashes = hashes()
    let stack
    try {
      stack = await startNativeStack({ root, dataRoot: state, environment })
      assert.equal(stack.status.sensorsEnabled, 0)
      assert.equal(stack.status.backend, 'norama-independent')
      const stored = await memoryTask(stack, { operation: 'remember', scope: 'crash-recovery-fixture',
        content: 'Synthetic memory must survive owned component loss' })
      const ids = ownedIds(stack)
      if (component === 'worker') {
        process.kill(stack.runtime.status.workerPid)
      } else {
        const target = stack[component].child
        assert.ok(target.kill(), 'Only the exact test-owned component is terminated')
      }
      const failure = await bounded(stack.exited, component === 'worker' ? 8000 : 30000)
      assert.equal(failure.component, component === 'worker' ? 'runtime' : component)
      if (component !== 'worker') assert.ok(failure.code !== 0 || failure.exitSignal !== null)
      assert.notEqual(failure.cleanupFailed, true)
      await stack.stop()
      assertDrained(ids, state)
      stack = null
      // Recovery is an explicit new owner action, never an implicit fallback
      // to another runtime or an uncontrolled restart loop.
      stack = await startNativeStack({ root, dataRoot: state, environment })
      assert.equal(stack.status.backend, 'norama-independent')
      assert.equal(stack.status.taskExecutionQualified, false)
      const recalled = await memoryTask(stack, { operation: 'recall', scope: 'crash-recovery-fixture' })
      assert.deepEqual(recalled.entries.map(entry => entry.id), [stored.entry.id])
      const recovery = await gracefulStop(stack, state)
      stack = null
      assert.deepEqual(hashes(), initialHashes)
      const receipt = join(trial, 'failure-recovery-receipt.json')
      writeFileSync(receipt, JSON.stringify({ passed: true, component, failure, recovery,
        syntheticMemoryRestored: true, explicitRestart: true, sourceHashes: initialHashes,
        coveredSourceUnchanged: true, ownerProfileUsed: false, sensorsUsed: false,
        installedAcceptanceVerified: false, wholeSystemAcceptanceVerified: false }, null, 2))
      t.diagnostic(`Evidence: ${receipt}`)
    } finally { if (stack) await stack.stop() }
  })
}

test('real active inference worker crash terminates the stream and permits explicit generation recovery', {
  skip: !enabled, timeout: 120000,
}, async t => {
  const trial = isolatedTrial('.native-active-worker-loss-'), state = join(trial, 'synthetic-state')
  const initialHashes = hashes()
  let stack, reader
  try {
    stack = await startNativeStack({ root, dataRoot: state, environment })
    const stored = await memoryTask(stack, { operation: 'remember', scope: 'active-crash-fixture',
      content: 'Synthetic active-generation crash recovery marker' })
    const runtimeHeaders = { Authorization: `Bearer ${stack.environment.NORI_RUNTIME_API_KEY}`,
      'Content-Type': 'application/json' }
    const response = await fetch(`${stack.environment.NORI_RUNTIME_URL}/v1/chat`, {
      method: 'POST', headers: runtimeHeaders, redirect: 'error', signal: AbortSignal.timeout(45000),
      body: JSON.stringify({ model_id: stack.status.modelId, stream: true, max_tokens: 2048,
        messages: [{ role: 'user', content: 'Count every integer from 1 to 1000, one per line. Do not abbreviate or skip numbers.' }] }) })
    assert.equal(response.status, 200)
    assert.match(response.headers.get('content-type'), /text\/event-stream/)
    const requestId = Number(response.headers.get('x-nori-request-id'))
    assert.ok(Number.isSafeInteger(requestId) && requestId > 0)
    reader = response.body.getReader()
    const decoder = new TextDecoder()
    let streamText = ''
    while (!streamText.includes('event: token')) {
      const chunk = await bounded(reader.read(), 15000)
      assert.equal(chunk.done, false, 'Generation must emit an actual token before failure injection')
      streamText += decoder.decode(chunk.value, { stream: true })
      assert.ok(streamText.length < 131072)
      assert.ok(!streamText.includes('[DONE]'), 'Generation completed before failure injection')
    }
    const healthResponse = await fetch(`${stack.environment.NORI_RUNTIME_URL}/health`, {
      headers: runtimeHeaders, redirect: 'error', signal: AbortSignal.timeout(3000) })
    assert.equal(healthResponse.status, 200)
    assert.equal((await healthResponse.json()).active_request_id, requestId)
    const ids = ownedIds(stack)
    process.kill(stack.runtime.status.workerPid)
    let streamTransportFailed = false
    try {
      while (true) {
        const chunk = await bounded(reader.read(), 8000)
        if (chunk.done) break
        streamText += decoder.decode(chunk.value, { stream: true })
        assert.ok(streamText.length < 131072)
      }
    } catch (error) {
      // A broken transport is a failed stream, not successful completion.
      // A local deadline violation is never accepted as recovery evidence.
      if (error.message === 'Owned failure response exceeded deadline') throw error
      streamTransportFailed = true
    }
    assert.ok(!streamText.includes('[DONE]'), 'A crashed generation must not report successful completion')
    assert.ok(streamTransportFailed || streamText.includes('event: error'))
    const failure = await bounded(stack.exited, 10000)
    assert.equal(failure.component, 'runtime')
    assert.equal(failure.code, 1)
    assert.notEqual(failure.cleanupFailed, true)
    await stack.stop()
    assertDrained(ids, state)
    stack = null
    reader.releaseLock(); reader = null
    stack = await startNativeStack({ root, dataRoot: state, environment })
    const recalled = await memoryTask(stack, { operation: 'recall', scope: 'active-crash-fixture' })
    assert.deepEqual(recalled.entries.map(entry => entry.id), [stored.entry.id])
    const recovered = await fetch(`${stack.environment.NORI_RUNTIME_URL}/v1/chat`, {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(30000),
      headers: { Authorization: `Bearer ${stack.environment.NORI_RUNTIME_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model_id: stack.status.modelId, stream: false, max_tokens: 8,
        messages: [{ role: 'user', content: 'Say hello.' }] }) })
    assert.equal(recovered.status, 200)
    const answer = await recovered.json()
    assert.equal(answer.model_id, stack.status.modelId)
    assert.equal(typeof answer.text, 'string')
    assert.ok(answer.text.length > 0)
    const recovery = await gracefulStop(stack, state)
    stack = null
    assert.deepEqual(hashes(), initialHashes)
    const receipt = join(trial, 'active-crash-receipt.json')
    writeFileSync(receipt, JSON.stringify({ passed: true, failure, recovery, sourceHashes: initialHashes,
      coveredSourceUnchanged: true, realTokenBeforeCrash: true, activeRequestConfirmed: true,
      streamErrorEvent: streamText.includes('event: error'), streamTransportFailed,
      falseSuccessTerminal: false, recoveredGeneration: true, syntheticMemoryRestored: true,
      ownerProfileUsed: false, sensorsUsed: false, installedAcceptanceVerified: false,
      wholeSystemAcceptanceVerified: false }, null, 2))
    t.diagnostic(`Evidence: ${receipt}`)
  } finally {
    if (reader) { try { await reader.cancel() } catch {} }
    if (stack) await stack.stop()
  }
})

test('real active generation cancellation releases admission and reuses the same healthy worker', {
  skip: !enabled, timeout: 90000,
}, async t => {
  const trial = isolatedTrial('.native-active-cancel-'), state = join(trial, 'synthetic-state')
  const initialHashes = hashes()
  let stack, reader
  try {
    stack = await startNativeStack({ root, dataRoot: state, environment })
    const ids = ownedIds(stack), url = stack.environment.NORI_RUNTIME_URL
    const headers = { Authorization: `Bearer ${stack.environment.NORI_RUNTIME_API_KEY}`, 'Content-Type': 'application/json' }
    const response = await fetch(`${url}/v1/chat`, {
      method: 'POST', headers, redirect: 'error', signal: AbortSignal.timeout(45000),
      body: JSON.stringify({ model_id: stack.status.modelId, stream: true, max_tokens: 2048,
        messages: [{ role: 'user', content: 'Count every integer from 1 to 1000, one per line. Do not abbreviate or skip numbers.' }] }) })
    assert.equal(response.status, 200)
    const requestId = Number(response.headers.get('x-nori-request-id'))
    assert.ok(Number.isSafeInteger(requestId) && requestId > 0)
    reader = response.body.getReader()
    const decoder = new TextDecoder()
    let streamText = ''
    while (!streamText.includes('event: token')) {
      const chunk = await bounded(reader.read(), 15000)
      assert.equal(chunk.done, false)
      streamText += decoder.decode(chunk.value, { stream: true })
      assert.ok(streamText.length < 131072)
      assert.ok(!streamText.includes('[DONE]'))
    }
    const cancellation = await fetch(`${url}/v1/cancel`, { method: 'POST', headers,
      redirect: 'error', signal: AbortSignal.timeout(5000), body: JSON.stringify({ request_id: requestId }) })
    assert.equal(cancellation.status, 200)
    assert.equal((await cancellation.json()).cancelled, true)
    while (true) {
      const chunk = await bounded(reader.read(), 8000)
      if (chunk.done) break
      streamText += decoder.decode(chunk.value, { stream: true })
      assert.ok(streamText.length < 131072)
    }
    assert.ok(streamText.includes('native request cancelled'))
    assert.ok(!streamText.includes('[DONE]'))
    reader.releaseLock(); reader = null
    const healthResponse = await fetch(`${url}/health`, { headers, redirect: 'error', signal: AbortSignal.timeout(3000) })
    assert.equal(healthResponse.status, 200)
    const health = await healthResponse.json()
    assert.equal(health.ready, true)
    assert.equal(health.active_request_id, null)
    assert.equal(health.worker_pid, ids[2])
    assert.ok(ids.every(alive))
    const { nativeRuntimeChat } = await import('../bridge/native-runtime.mjs')
    let answer = ''
    for await (const token of nativeRuntimeChat({ endpoint: url,
      apiKey: stack.environment.NORI_RUNTIME_API_KEY, modelId: stack.status.modelId,
      maxTokens: 8, messages: [{ role: 'user', content: 'Say hello.' }],
      signal: AbortSignal.timeout(30000) })) answer += token
    assert.ok(answer.length > 0)
    const shutdown = await gracefulStop(stack, state)
    stack = null
    assert.deepEqual(hashes(), initialHashes)
    const receipt = join(trial, 'active-cancel-receipt.json')
    writeFileSync(receipt, JSON.stringify({ passed: true, sourceHashes: initialHashes,
      coveredSourceUnchanged: true, realTokenBeforeCancellation: true, cancelAcknowledged: true,
      cancellationTerminal: true, falseSuccessTerminal: false, sameWorkerReused: true,
      subsequentGeneration: true, actualDesktopBridgeCompletion: true,
      shutdown, ownerProfileUsed: false, sensorsUsed: false,
      installedAcceptanceVerified: false, wholeSystemAcceptanceVerified: false }, null, 2))
    t.diagnostic(`Evidence: ${receipt}`)
  } finally {
    if (reader) { try { await reader.cancel() } catch {} }
    if (stack) await stack.stop()
  }
})
