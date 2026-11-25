// Explicit real GPU/model/managed-launch/desktop-WebSocket acceptance probe.
// Not part of fixture-only unit discovery;never publishes its runtime key.
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { mkdtempSync, rmSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join, relative, resolve, sep } from 'node:path'
import { wavDetails } from '../../../apps/desktop/scripts/verify-local-kokoro.mjs'
const root = fileURLToPath(new URL('../../../', import.meta.url))
const appRoot = join(root, 'apps', 'desktop')
const require = createRequire(join(appRoot, 'package.json'))
const { startNativeStack } = require(join(appRoot, 'desktop/native-stack.cjs'))
const WebSocket = require('ws')
const settings = mkdtempSync(join(root, 'verification', '.native-startup-probe-'))
let service, bridge, socket, speechPid
const started = performance.now()
const wait = ms => new Promise(resolveWait => setTimeout(resolveWait, ms))
const alive = pid => { try { process.kill(pid, 0); return true } catch { return false } }
const until = async (predicate, label, timeout = 30000) => {
  const deadline = performance.now() + timeout
  while (performance.now() < deadline) {
    const found = await predicate()
    if (found) return found
    await wait(25)
  }
  throw new Error(`Real startup probe timed out: ${label}`)
}
try {
  service = await startNativeStack({ root, dataRoot: join(settings, 'core') })
  const startupSeconds = (performance.now() - started) / 1000
  const reserve = createServer()
  await new Promise(resolveReady => reserve.listen(0, '127.0.0.1', resolveReady))
  const port = reserve.address().port
  await new Promise(resolveClosed => reserve.close(resolveClosed))
  bridge = spawn(process.execPath, [join(appRoot, 'bridge/server.mjs')], {
    cwd: appRoot, windowsHide: true, shell: false, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, ...service.environment, NORI_BRIDGE_PORT: String(port),
      NORI_SETTINGS_DIR: settings, NORI_LEARNING_FILE: join(settings, 'probe-memory.json'),
      NORI_ROOT: root, NORI_ALLOW_WRITES: '1',
      NORI_PYTHON: join(settings, 'missing-stt-interpreter.exe') },
  })
  // Bound/drain diagnostics,never echo them or any inherited private fields.
  let diagnosticBytes = 0
  const drain = bytes => { diagnosticBytes += bytes.length; assert.ok(diagnosticBytes < 65536) }
  bridge.stdout.on('data', drain)
  bridge.stderr.on('data', drain)
  bridge.on('error', () => {})
  const endpoint = `http://127.0.0.1:${port}`
  const health = await until(async () => {
    if (bridge.exitCode !== null) throw new Error('Owned desktop bridge exited before readiness')
    try {
      const response = await fetch(`${endpoint}/health`, { signal: AbortSignal.timeout(1500) })
      if (response.ok) return response.json()
    } catch { return null }
  }, 'desktop bridge health')
  assert.equal(health.inference.ready, true)
  assert.equal(health.inference.backend, 'norama-independent')
  assert.equal(health.inference.modelId, service.status.modelId)
  assert.ok(!JSON.stringify(health).includes(service.environment.NORI_RUNTIME_API_KEY))
  assert.ok(!JSON.stringify(health).includes(service.environment.NORI_API_TOKEN))
  assert.equal(health.tts, true)
  assert.equal(health.speech.ready, false, 'Speech must not report ready just because files exist')
  assert.equal(health.speech.workerPid, null)
  assert.equal(health.speech.cloudFallback, false)
  const speechStart = performance.now()
  const clips = []
  const speak = text => fetch(`${endpoint}/tts`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text }), signal: AbortSignal.timeout(30000),
  })
  for (const text of [{ invalid: 'not a string' }, '', 'x'.repeat(2001)]) {
    const refused = await speak(text)
    assert.equal(refused.status, 400)
    await refused.text()
  }
  for (const text of ['Nori is ready to help.', 'I am speaking from the local Nori folder.']) {
    const response = await speak(text)
    assert.equal(response.status, 200)
    assert.equal(response.headers.get('content-type'), 'audio/wav')
    clips.push(wavDetails(Buffer.from(await response.arrayBuffer())))
    const warmed = await (await fetch(`${endpoint}/health`, { signal: AbortSignal.timeout(1500) })).json()
    assert.equal(warmed.speech.ready, true)
    assert.equal(warmed.speech.backend, 'kokoro-local')
    assert.ok(Number.isSafeInteger(warmed.speech.workerPid) && warmed.speech.workerPid > 0)
    if (speechPid === undefined) speechPid = warmed.speech.workerPid
    else assert.equal(warmed.speech.workerPid, speechPid, 'HTTP speech should reuse its owned worker')
    assert.ok(alive(speechPid))
  }
  const speechSeconds = (performance.now() - speechStart) / 1000
  const frames = []
  socket = new WebSocket(endpoint.replace('http:', 'ws:'), { origin: 'http://127.0.0.1:5188' })
  socket.on('message', bytes => frames.push(JSON.parse(bytes)))
  await new Promise((resolveOpen, reject) => { socket.once('open', resolveOpen); socket.once('error', reject) })
  const ready = await until(() => frames.find(frame => frame.type === 'ready'), 'ready frame')
  assert.deepEqual(ready.models.map(model => model.id), ['nori-auto', service.status.modelId])
  const profiles = ['lightning-fast', 'balanced', 'deep']
  let replySeconds
  for (const profile of profiles) {
    socket.send(JSON.stringify({ type: 'config', effort: profile, model: service.status.modelId }))
    await until(() => frames.find(frame => frame.type === 'ready' && frame.effort === profile), 'response style')
    const ask = 'real-' + profile
    const replyStart = performance.now()
    socket.send(JSON.stringify({ type: 'ask', id: ask, text: 'Just say hello.' }))
    const answer = await until(() => frames.find(frame => frame.ask === ask && ['done', 'error'].includes(frame.type)), 'real native reply')
    assert.equal(answer.type, 'done', answer.message)
    assert.ok(answer.text.trim())
    if (replySeconds === undefined) replySeconds = (performance.now() - replyStart) / 1000
  }
  socket.send(JSON.stringify({ type: 'ask', id: 'tool-gap', text: '*work edit a file in the project' }))
  const gap = await until(() => frames.find(frame => frame.ask === 'tool-gap' && frame.type === 'error'), 'explicit Core gap')
  assert.match(gap.message, /native task planning and tool execution have not passed qualification/)
  socket.send(JSON.stringify({ type: 'ask', id: 'after-gap', text: 'Just say hello.' }))
  const recovery = await until(() => frames.find(frame => frame.ask === 'after-gap' && ['done', 'error'].includes(frame.type)), 'reply after unsupported action')
  assert.equal(recovery.type, 'done', recovery.message)
  assert.ok(recovery.text.trim())
  console.log(JSON.stringify({ managed_native_startup: 'PASS', desktop_websocket_chat: 'PASS',
    profiles, public_health_key_leak: false, unqualified_tools_no_dispatch: 'PASS',
    startup_seconds: startupSeconds, first_websocket_reply_seconds: replySeconds,
    local_http_speech: 'PASS', speech_invalid_input_refusal: 'PASS', speech_worker_reused: true,
    speech_pid: speechPid, speech_seconds: speechSeconds, clips,
    microphone_used: false, playback_used: false,
    core_pid: service.status.corePid, runtime_pid: service.status.runtimePid, worker_pid: service.status.workerPid }))
} finally {
  socket?.terminate()
  if (bridge && bridge.exitCode === null) {
    const exit = new Promise(resolveExit => bridge.once('exit', resolveExit))
    bridge.kill()
    await exit
  }
  if (speechPid) await until(() => !alive(speechPid), 'owned speech worker exit after bridge pipe closes', 10000)
  if (service) {
    await service.stop()
    await until(() => !alive(service.status.workerPid), 'owned GPU worker exit', 5000)
  }
  const ownedTemp = relative(resolve(root), resolve(settings))
  assert.ok(ownedTemp.startsWith('verification' + sep + '.native-startup-probe-') && !ownedTemp.includes('..'))
  rmSync(settings, { recursive: true, force: true }) // Only this fresh test fixture.
  console.log(JSON.stringify({ owned_startup_cleanup: 'PASS', owned_speech_cleanup: speechPid ? 'PASS' : 'NOT_STARTED' }))
}
