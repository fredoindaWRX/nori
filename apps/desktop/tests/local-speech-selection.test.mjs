/** Actual renderer speaker code, with synthetic audio devices (no mic). */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

const source = readFileSync(new URL('../src/lib/tts.ts', import.meta.url), 'utf8')
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
const expressionExports = await import('../bridge/speech-expression.mjs')
function fixture({ available = true, badResponse = false, pending = false, delayProbe = false, clearGlobalCaps = false,
  nativeEvents = 'complete', fakeTimers = false } = {}) {
  const events = [], revoked = [], requests = []
  const timeouts = new Map(), intervals = new Map(), utterances = []
  let timerId = 0, nativeMode = nativeEvents
  const timers = fakeTimers ? {
    setTimeout(fn, delay) { const id = ++timerId; timeouts.set(id, { fn, delay }); return id },
    clearTimeout(id) { timeouts.delete(id) },
    setInterval(fn, delay) { const id = ++timerId; intervals.set(id, { fn, delay }); return id },
    clearInterval(id) { intervals.delete(id) },
  } : { setTimeout, clearTimeout, setInterval, clearInterval }
  let current = { tts: false, stt: false }, releaseProbe
  const probeWait = delayProbe ? new Promise(resolve => { releaseProbe = resolve }) : Promise.resolve()
  const voices = [{ name: 'Microsoft Zira', lang: 'en-US', localService: true }]
  const speechSynthesis = { getVoices: () => voices, addEventListener() {}, resume() {}, cancel() {},
    speak(u) { events.push('system'); utterances.push(u); queueMicrotask(() => {
      if (nativeMode === 'silent') return
      u.onstart?.()
      if (nativeMode === 'complete') u.onend?.()
    }) } }
  class Audio {
    play() { events.push('neural'); queueMicrotask(() => { this.onplaying?.(); this.onended?.() }); return Promise.resolve() }
    pause() { this.onpause?.() }
  }
  const exports = {}
  vm.runInNewContext(code, { exports, require(name) {
    if (name === '../config') return { BACKEND: 'bridge', BRIDGE_HTTP_URL: 'http://127.0.0.1:9999' }
    if (name === '../../bridge/speech-expression.mjs') return expressionExports
    if (name === './speech-expression') return expressionExports
    if (name === '../../bridge/personality/profile.mjs') return {}
    if (name === './capabilities') return { caps: () => current, async probeCapabilities() {
      events.push('probe'); await probeWait; const result = { tts: available, stt: false }
      current = clearGlobalCaps ? { tts: false, stt: false } : result
      return result
    } }
    throw Error(`Unexpected import: ${name}`)
  }, window: {}, speechSynthesis, SpeechSynthesisUtterance: class { constructor(text) { this.text = text } },
  localStorage: { getItem: () => null, removeItem() {}, setItem() { events.push('saved-system-choice') } },
  Audio, AudioContext: class { constructor() { throw Error('Synthetic analyser unavailable') } },
  requestAnimationFrame: () => 1, cancelAnimationFrame() {},
  URL: { createObjectURL: () => `blob:fixture-${requests.length}`, revokeObjectURL: url => revoked.push(url) },
  AbortController, AbortSignal, Date, ...timers,
  console: { warn() {} }, fetch: async (url, options) => {
    requests.push({ url, ...options }); events.push('fetch')
    if (pending) return await new Promise((_, reject) => {
      if (options.signal.aborted) reject(new DOMException('Aborted', 'AbortError'))
      else options.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true })
    })
    return { ok: !badResponse, headers: new Headers({ 'content-type': badResponse ? 'text/html' : 'audio/wav' }), blob: async () => new Blob([new Uint8Array(100)]) }
  } })
  return { api: exports, events, requests, revoked, releaseProbe, timeouts, intervals, utterances,
    completeNative: () => { nativeMode = 'complete' },
    runTimeouts(delay) { for (const [id, timer] of [...timeouts]) if (timer.delay === delay) {
      timeouts.delete(id); timer.fn()
    } },
  }
}
test('first speech waits for local capability probe, never defaults prematurely to Zira', async () => {
  const f = fixture({ delayProbe: true }), names = []
  const off = f.api.watchVoice(name => names.push(name))
  const speaker = f.api.createSpeaker(); speaker.say('Hey, I am Nori.'); const end = speaker.end()
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(f.events, ['probe'])
  f.releaseProbe(); await end; off()
  assert.deepEqual(f.events, ['probe', 'fetch', 'neural'])
  assert.equal(f.api.diag.engine, 'neural')
  assert.equal(f.api.currentVoiceName(), 'Nori local · Kokoro')
  assert.equal(names.at(-1), 'Nori local · Kokoro')
  assert.equal(f.requests[0].url, 'http://127.0.0.1:9999/tts')
  assert.equal(f.requests[0].redirect, 'error')
  assert.deepEqual(JSON.parse(f.requests[0].body), { text: 'Hey, I am Nori.', expression: expressionExports.DEFAULT_SPEECH_EXPRESSION })
  assert.equal(f.revoked.length, 1)
})
test('personality affect changes local Kokoro cadence inside bounded limits', async () => {
  const f = fixture(), speaker = f.api.createSpeaker()
  f.api.setSpeechPersonality({
    mode: 'celebrating', appliedProfile: { enthusiasm: 100 },
    affect: { joy: 90, amusement: 80, excitement: 75, concern: 0, frustration: 0, urgency: 0, uncertainty: 0 },
  })
  speaker.say('That is wonderful news.'); await speaker.end()
  const request = JSON.parse(f.requests[0].body)
  assert.equal(request.text, 'That is wonderful news.')
  assert.ok(request.expression.speed > 1 && request.expression.speed <= 1.04)
  assert.ok(request.expression.sentencePause >= 0.18 && request.expression.sentencePause <= 0.27)
})
test('serious affect slows the installed local system voice', async () => {
  const f = fixture({ available: false }), speaker = f.api.createSpeaker()
  f.api.setSpeechPersonality({
    mode: 'supportive', appliedProfile: { enthusiasm: 100 },
    affect: { joy: 100, amusement: 100, excitement: 100, concern: 100, frustration: 100, urgency: 100, uncertainty: 100 },
  })
  speaker.say('Take your time.'); await speaker.end()
  assert.ok(f.utterances[0].rate < 1 && f.utterances[0].rate >= 0.94)
  assert.ok(f.utterances[0].pitch >= 0.98 && f.utterances[0].pitch <= 1.06)
})
test('failed neural generation reports the actual installed local fallback, not a neural voice', async () => {
  const f = fixture({ badResponse: true }), speaker = f.api.createSpeaker()
  speaker.say('Local fallback.'); await speaker.end()
  assert.deepEqual(f.events, ['probe', 'fetch', 'system'])
  assert.equal(f.api.diag.engine, 'system')
  assert.equal(f.api.diag.systemFallbacks, 1)
  assert.match(f.api.currentVoiceName(), /Zira.*local system fallback/)
})
test('missing local model only uses installed local speech, never a cloud endpoint', async () => {
  const f = fixture({ available: false }), speaker = f.api.createSpeaker()
  speaker.say('Still local.'); await speaker.end()
  assert.deepEqual(f.events, ['probe', 'system'])
  assert.equal(f.requests.length, 0)
})
test('cancelling a pending generation aborts its fetch and settles without speaking the tail', async () => {
  const f = fixture({ pending: true }), speaker = f.api.createSpeaker()
  speaker.say('A pending sentence.'); const end = speaker.end()
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(f.requests.length, 1)
  speaker.cancel(); await end
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(f.requests[0].signal.aborted, true)
  assert.equal(f.events.includes('neural'), false)
  assert.equal(f.events.includes('system'), false)
  assert.equal(f.api.diag.systemFallbacks, 0)
})
test('cancel before capability readiness never starts synthesis', async () => {
  const f = fixture({ delayProbe: true }), speaker = f.api.createSpeaker()
  speaker.say('Do not speak.'); speaker.cancel(); f.releaseProbe(); await speaker.end()
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(f.events, ['probe'])
})
test('voice picker does not pretend system voice changes affect the neural worker', async () => {
  const f = fixture(), speaker = f.api.createSpeaker()
  speaker.say('Local neural.'); await speaker.end()
  assert.equal(f.api.cycleVoice(), 'Nori local · Kokoro')
  assert.equal(f.events.includes('saved-system-choice'), false)
})
test('an unrelated input-capability refresh cannot switch an already-checked speaker to Zira', async () => {
  const f = fixture({ clearGlobalCaps: true }), speaker = f.api.createSpeaker()
  speaker.say('Keep the checked local voice.'); await speaker.end()
  assert.deepEqual(f.events, ['probe', 'fetch', 'neural'])
})

test('cancelled silent system voice drains its watchdog even when the OS emits no completion event', async () => {
  const f = fixture({ available: false, nativeEvents: 'silent', fakeTimers: true })
  const speaker = f.api.createSpeaker()
  speaker.say('Cancel this silent sentence.'); const end = speaker.end()
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(f.timeouts.size, 1)
  assert.deepEqual(f.events, ['probe', 'system'])
  speaker.cancel(); await end
  assert.equal(f.timeouts.size, 0)
  f.runTimeouts(700)
  assert.deepEqual(f.events, ['probe', 'system'], 'cancelled speech must not be requeued')
  f.utterances[0].onstart?.() // An OS-delivered late event must not revive it.
  assert.equal(f.intervals.size, 0)
  assert.equal(f.api.diag.started, 0)
})

test('cancel after system voice starts clears its keepalive and allows a later speaker to finish', async () => {
  const f = fixture({ available: false, nativeEvents: 'start-only', fakeTimers: true })
  const speaker = f.api.createSpeaker()
  speaker.say('Stop mid sentence.'); const end = speaker.end()
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(f.intervals.size, 1)
  speaker.cancel(); await end
  assert.equal(f.intervals.size, 0)
  assert.equal(f.timeouts.size, 0)
  f.utterances[0].onstart?.()
  assert.equal(f.intervals.size, 0)
  f.completeNative()
  const next = f.api.createSpeaker()
  next.say('A clean next sentence.'); await next.end()
  assert.equal(f.intervals.size, 0)
  assert.equal(f.timeouts.size, 0)
  assert.deepEqual(f.events, ['probe', 'system', 'probe', 'system'])
})
