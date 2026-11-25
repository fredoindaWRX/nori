// Real desktop-owned runtime + Core lifecycle, isolated state and no renderer,
// sensors, tools, production-config rewrite or pre-existing service adoption.
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdtemp, rm } from 'node:fs/promises'
import { dirname, basename, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Socket } from 'node:net'
const require = createRequire(import.meta.url)
const { startNativeService } = require('../../../apps/desktop/desktop/native-service.cjs')
const { startNativeCore, ROLES } = require('../../../apps/desktop/desktop/native-core.cjs')
const { startNativeStack } = require('../../../apps/desktop/desktop/native-stack.cjs')
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
const verification = resolve(root, 'verification')
const state = await mkdtemp(resolve(verification, '.native-stack-probe-'))
let runtime, core, stack
const portClosed = port => new Promise(resolveClosed => {
  const socket = new Socket()
  let settled = false
  const finish = closed => { if (!settled) { settled = true; socket.destroy(); resolveClosed(closed) } }
  socket.once('connect', () => finish(false))
  socket.once('error', error => finish(error.code === 'ECONNREFUSED'))
  socket.setTimeout(2000, () => finish(false))
  socket.connect(port, '127.0.0.1')
})
try {
  runtime = await startNativeService({ root })
  core = await startNativeCore({ root, runtime, dataRoot: state })
  const key = core.environment.NORI_API_TOKEN
  assert.ok(!JSON.stringify(core.status).includes(key))
  assert.equal(core.status.sensorsEnabled, 0)
  assert.equal(core.status.taskExecutionQualified, false)
  const status = await fetch(`${core.environment.NORI_COUNCIL_URL}/health`, {
    headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(3000),
  }).then(response => response.json())
  assert.equal(status.knight, 'architect')
  assert.equal(status.model_ready, true)
  assert.equal(status.sensory.configured_count, 0)
  assert.equal(status.work_runtime.native_task_execution_qualified, false)
  assert.equal((await fetch(`${core.environment.NORI_COUNCIL_URL}/health`)).status, 401)
  const workUrl = `${core.environment.NORI_COUNCIL_URL}/work`
  const auth = { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }
  const tasks = () => fetch(workUrl, { headers: auth, signal: AbortSignal.timeout(3000) })
    .then(response => response.json())
  const beforeTasks = await tasks()
  const deniedWork = await fetch(workUrl, {
    method: 'POST', headers: auth, body: JSON.stringify({ goal: 'Read notes.txt', request_id: 'native-gate-probe' }),
    signal: AbortSignal.timeout(5000),
  })
  assert.equal(deniedWork.status, 503)
  const denied = await deniedWork.json()
  assert.equal(denied.error, 'native_task_execution_unqualified')
  assert.equal(denied.task_started, false)
  assert.deepEqual(await tasks(), beforeTasks)
  const response = await fetch(`${core.environment.NORI_COUNCIL_URL}/chat`, {
    method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ goal: 'Just say hello, nothing else.' }), signal: AbortSignal.timeout(60000),
  })
  assert.equal(response.status, 200)
  const answer = await response.json()
  assert.equal(answer.status, 'completed')
  assert.ok(answer.response.trim())
  assert.equal(answer.inference.backend, 'norama-independent')
  const health = await fetch(`${runtime.environment.NORI_RUNTIME_URL}/health`, {
    headers: { Authorization: `Bearer ${runtime.environment.NORI_RUNTIME_API_KEY}` },
    signal: AbortSignal.timeout(3000),
  }).then(response => response.json())
  assert.equal(health.worker_pid, runtime.status.workerPid)
  await core.stop()
  assert.equal((await core.exited).code, 0)
  for (const role of ROLES) assert.equal(await portClosed(core.status.ports[role]), true)
  // Core does not own or shut down the parent's inference service.
  assert.equal(runtime.child.exitCode, null)
  await runtime.stop()
  assert.equal((await runtime.exited).code, 0)
  assert.equal(await portClosed(Number(new URL(runtime.environment.NORI_RUNTIME_URL).port)), true)
  // Exercise the exact source-app orchestrator, not just its two helpers. A
  // stopped Core fails the whole stack closed; it must not leave the GPU behind.
  stack = await startNativeStack({ root, dataRoot: resolve(state, 'stack') })
  stack.core.child.stdin.end()
  const ended = await Promise.race([stack.exited,
    new Promise((_, reject) => {
      const timeout = setTimeout(() => reject(new Error('Owned stack shutdown deadline')), 40000)
      timeout.unref()
    })])
  assert.equal(ended.component, 'core')
  assert.notEqual(ended.cleanupFailed, true)
  assert.equal((await stack.runtime.exited).code, 0)
  for (const role of ROLES) assert.equal(await portClosed(stack.core.status.ports[role]), true)
  assert.equal(await portClosed(Number(new URL(stack.runtime.environment.NORI_RUNTIME_URL).port)), true)
  console.log(JSON.stringify({ owned_native_stack: 'PASS', twelve_core_routes: 'PASS',
    private_auth: 'PASS', architect_sentinel_gpu_chat: 'PASS', answer: answer.response,
    core_native_work_admission: 'PASS', rejected_task_created: false,
    core_stop_ports_closed: 'PASS', runtime_survives_core_stop: 'PASS', runtime_shutdown: 'PASS',
    corePid: core.status.corePid, runtimePid: runtime.status.runtimePid,
    workerPid: runtime.status.workerPid, stack_core_exit_cleans_runtime: 'PASS',
    orchestratedCorePid: stack.status.corePid, orchestratedRuntimePid: stack.status.runtimePid,
    sensorsEnabled: 0, toolsExecuted: 0 }))
} finally {
  try { if (stack) await stack.stop(); if (core) await core.stop() }
  finally { if (runtime) await runtime.stop() }
  // Delete only this known temporary test directory, never the workspace.
  assert.equal(dirname(state), verification)
  assert.match(basename(state), /^\.native-stack-probe-[A-Za-z0-9]+$/)
  await rm(state, { recursive: true, force: false })
}
