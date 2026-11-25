const test = require('node:test')
const assert = require('node:assert/strict')
const vm = require('node:vm')
const { installMobileVoice } = require(process.env.NORI_MOBILE_VOICE_SOURCE || '../desktop/mobile-voice.cjs')
const { createVoiceActivityGate } = require('../desktop/voice-activity.cjs')

// All media, timers, playback and network operations below are synthetic. The
// serialized installer cannot reach the OS microphone, camera, audio or Nori.
function fixture(options = {}) {
  const listeners = new Map(), documentListeners = new Map(), timers = new Map(), requests = [], recorders = [], streams = [], acquisitions = []
  let timerSerial = 0, streamSerial = 0, sessionSerial = 0, submitted = 0
  class Element {
    constructor(tag) { this.tag = tag; this.children = []; this.style = {}; this.attributes = {}; this.dataset = {}; this.textContent = ''; this.value = ''; this.disabled = false }
    setAttribute(name, value) { this.attributes[name] = value }
    append(...nodes) { this.children.push(...nodes) }
    insertBefore(node, before) { const index = this.children.indexOf(before); this.children.splice(index < 0 ? this.children.length : index, 0, node) }
    dispatchEvent() {}
  }
  function makeStream() {
    const tracks = [0, 1].map(() => ({ readyState: 'live', stopCalls: 0, listeners: new Map(),
      stop() { this.stopCalls++; this.readyState = 'ended' },
      addEventListener(name, callback) { this.listeners.set(name, callback) },
      removeEventListener(name, callback) { if (this.listeners.get(name) === callback) this.listeners.delete(name) },
      endExternally() { this.readyState = 'ended'; this.listeners.get('ended')?.(); this.onended?.() },
    }))
    const stream = { id: ++streamSerial, tracks, getTracks: () => tracks }
    streams.push(stream)
    return stream
  }
  class FakeRecorder {
    static isTypeSupported(type) { return type === 'audio/webm;codecs=opus' }
    constructor(stream, settings) { this.stream = stream; this.settings = settings; this.state = 'inactive'; recorders.push(this) }
    start() { this.state = 'recording' }
    stop() { this.state = 'inactive' }
    async deliverStop(data = new Blob(['synthetic audio bytes'])) { this.ondataavailable?.({ data }); return this.onstop?.() }
  }
  const body = new Element('body'), activity = new Element('details'), prompt = new Element('textarea'), send = new Element('button'), composer = new Element('form')
  prompt.maxLength = 512
  composer.requestSubmit = () => { submitted++ }
  body.append(activity)
  const state = { hidden: false, rows: [], acquire: options.acquire || (async () => makeStream()), post: null }
  const document = { body, get hidden() { return state.hidden }, createElement: tag => new Element(tag),
    getElementById: id => ({ 'activity-panel': activity, prompt, send, composer })[id],
    querySelectorAll: () => state.rows,
    addEventListener: (name, callback) => documentListeners.set(name, callback) }
  const context = { document, navigator: { mediaDevices: { getUserMedia: async settings => { acquisitions.push(settings); return state.acquire() } } },
    MediaRecorder: FakeRecorder, AbortController,
    AbortSignal: { any: AbortSignal.any.bind(AbortSignal), timeout: () => new AbortController().signal },
    window: { addEventListener: (name, callback) => listeners.set(name, callback) },
    setTimeout(callback, ms) { const id = ++timerSerial; timers.set(id, { callback, ms }); return id }, clearTimeout(id) { timers.delete(id) },
    URL: { createObjectURL: () => 'blob:synthetic-voice', revokeObjectURL() {} },
    Audio: class { async play() {} pause() {} }, Blob, Uint8Array, Float32Array, Event,
    btoa: value => Buffer.from(value, 'binary').toString('base64'),
    fetch: async (path, init) => {
      requests.push({ path, init, body: JSON.parse(init.body) })
      if (state.post) { const response = await state.post(path, init); if (response) return response }
      if (path === '/voice/start') return { ok: true, json: async () => ({ token: (++sessionSerial).toString(16).padStart(64, '0'), expiresAt: Date.now() + 600000 }) }
      if (path === '/voice/transcribe') return { ok: true, json: async () => ({ text: 'Synthetic transcript' }) }
      if (path === '/voice/speak') return { ok: true, blob: async () => new Blob(['synthetic audio reply']) }
      return { ok: true, json: async () => ({}) }
    } }
  vm.createContext(context)
  vm.runInContext('(' + installMobileVoice.toString() + ')(' + createVoiceActivityGate.toString() + ')', context)
  const panel = body.children.find(node => node.tag === 'section')
  const [call, record, read, label, automatic, handsfree] = panel.children
  return { state, streams, requests, recorders, acquisitions, timers, prompt, send, call, record, read, label, automatic, handsfree, makeStream,
    get submitted() { return submitted },
    hide() { state.hidden = true; documentListeners.get('visibilitychange')?.() },
    pagehide() { listeners.get('pagehide')?.() },
  }
}

test('mobile voice starts with no acquisition, request, automatic send/read or hands-free', () => {
  const f = fixture()
  assert.equal(f.acquisitions.length, 0)
  assert.equal(f.requests.length, 0)
  assert.equal(f.record.disabled, true)
  assert.equal(f.read.disabled, true)
  assert.equal(f.automatic.attributes['aria-pressed'], 'false')
  assert.equal(f.handsfree.attributes['aria-pressed'], 'false')
})

test('explicit call and hangup release every synthetic track and end only the call session', async () => {
  const f = fixture()
  await f.call.onclick()
  assert.equal(f.acquisitions.length, 1)
  assert.equal(f.acquisitions[0].video, false)
  assert.equal(f.call.textContent, 'Hang up')
  assert.equal(f.record.disabled, false)
  await f.call.onclick()
  assert.ok(f.streams[0].tracks.every(track => track.stopCalls === 1))
  assert.equal(f.call.textContent, 'Call Nori')
  assert.equal(f.record.disabled, true)
  assert.equal(f.read.disabled, true)
  assert.equal(f.requests.filter(request => request.path === '/voice/end').length, 1)
  assert.equal(f.requests.some(request => request.path === '/input'), false)
})

test('a late acquisition after pagehide is released before starting a voice session', async () => {
  let resolveAcquisition
  const f = fixture({ acquire: () => new Promise(resolve => { resolveAcquisition = resolve }) })
  const starting = f.call.onclick()
  f.pagehide()
  const stream = f.makeStream()
  resolveAcquisition(stream)
  await starting
  assert.ok(stream.tracks.every(track => track.stopCalls === 1))
  assert.equal(f.requests.length, 0)
  assert.equal(f.call.textContent, 'Call Nori')
})

test('manual recording defaults to reviewing the transcript rather than sending or reading it automatically', async () => {
  const f = fixture()
  await f.call.onclick()
  f.record.onclick()
  const recording = f.recorders[0]
  recording.stop()
  await recording.deliverStop()
  assert.equal(f.prompt.value, 'Synthetic transcript')
  assert.equal(f.submitted, 0)
  assert.equal(f.requests.some(request => request.path === '/voice/speak'), false)
  await f.call.onclick()
})

test('a delayed old recorder stop cannot cancel the new call recording limit', async () => {
  const f = fixture()
  await f.call.onclick()
  f.record.onclick()
  const oldRecording = f.recorders[0]
  await f.call.onclick()
  await f.call.onclick()
  f.record.onclick()
  const newRecording = f.recorders[1]
  const limit = [...f.timers].find(([, timer]) => timer.ms === 30000)?.[0]
  assert.ok(limit)
  await oldRecording.deliverStop()
  assert.equal(f.timers.has(limit), true, 'stale stop callback must not clear the current recording deadline')
  assert.equal(newRecording.state, 'recording')
  assert.equal(f.requests.some(request => request.path === '/voice/transcribe'), false)
  await f.call.onclick()
})

test('stale data and stop callbacks within the same call cannot stop a replacement recorder', async () => {
  const f = fixture()
  await f.call.onclick()
  f.record.onclick()
  const oldRecording = f.recorders[0]
  f.record.onclick()
  f.record.onclick()
  const replacement = f.recorders[1]
  const limit = [...f.timers].find(([, timer]) => timer.ms === 30000)?.[0]
  assert.ok(limit)
  oldRecording.ondataavailable({ data: { size: 8 * 1024 * 1024 + 1 } })
  await oldRecording.deliverStop()
  assert.equal(replacement.state, 'recording')
  assert.equal(f.timers.has(limit), true)
  assert.equal(f.requests.some(request => request.path === '/voice/transcribe'), false)
  await f.call.onclick()
})

test('a stale recorder error within the same call cannot hang up its replacement', async () => {
  const f = fixture()
  await f.call.onclick()
  f.record.onclick()
  const oldRecording = f.recorders[0]
  f.record.onclick()
  f.record.onclick()
  oldRecording.onerror()
  assert.equal(f.call.textContent, 'Hang up')
  assert.equal(f.recorders[1].state, 'recording')
  assert.ok(f.streams[0].tracks.every(track => track.stopCalls === 0))
  await f.call.onclick()
})

test('external current-track termination ends the call and releases remaining synthetic tracks', async () => {
  const f = fixture()
  await f.call.onclick()
  f.streams[0].tracks[0].endExternally()
  assert.equal(f.call.textContent, 'Call Nori')
  assert.equal(f.record.disabled, true)
  assert.equal(f.read.disabled, true)
  assert.ok(f.streams[0].tracks.every(track => track.stopCalls >= 1))
  assert.equal(f.requests.filter(request => request.path === '/voice/end').length, 1)
})

test('external termination of an old call track cannot end a newer call', async () => {
  const f = fixture()
  await f.call.onclick()
  const oldTrack = f.streams[0].tracks[0]
  await f.call.onclick()
  await f.call.onclick()
  oldTrack.endExternally()
  assert.equal(f.call.textContent, 'Hang up')
  assert.ok(f.streams[1].tracks.every(track => track.stopCalls === 0))
  await f.call.onclick()
})

test('visibility loss releases the microphone and resets automatic options', async () => {
  const f = fixture()
  await f.call.onclick()
  f.automatic.onclick()
  assert.equal(f.automatic.attributes['aria-pressed'], 'true')
  f.hide()
  assert.ok(f.streams[0].tracks.every(track => track.stopCalls === 1))
  assert.equal(f.automatic.attributes['aria-pressed'], 'false')
  assert.equal(f.handsfree.attributes['aria-pressed'], 'false')
  assert.equal(f.record.disabled, true)
})

test('a transient transcription failure sends nothing and leaves manual retry available', async () => {
  const f = fixture()
  await f.call.onclick()
  f.state.post = async path => path === '/voice/transcribe' ? { ok: false } : null
  f.record.onclick()
  f.recorders[0].stop()
  await f.recorders[0].deliverStop()
  assert.equal(f.prompt.value, '')
  assert.equal(f.submitted, 0)
  assert.equal(f.record.disabled, false)
  assert.equal(f.read.disabled, false)
  assert.match(f.label.textContent, /Transcription failed; no message sent/)
  f.state.post = null
  f.record.onclick()
  f.recorders[1].stop()
  await f.recorders[1].deliverStop()
  assert.equal(f.prompt.value, 'Synthetic transcript')
  assert.equal(f.submitted, 0)
  await f.call.onclick()
})

test('voice activity gate requires sustained local energy and stops after bounded silence', () => {
  const gate = createVoiceActivityGate()
  const loud = new Float32Array(16).fill(0.05), quiet = new Float32Array(16)
  assert.equal(gate.sample(loud, 0), null)
  assert.equal(gate.sample(loud, 100), null)
  assert.equal(gate.sample(loud, 200), 'start')
  assert.equal(gate.sample(quiet, 300), null)
  assert.equal(gate.sample(quiet, 1300), 'stop')
  assert.equal(gate.sample(loud, 10), null)
  assert.equal(gate.sample(loud, 9), 'reset')
})
