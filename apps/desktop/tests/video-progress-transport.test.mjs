import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import vm from 'node:vm'

const ts = createRequire(import.meta.url)('typescript')
const source = (name) => readFileSync(new URL(`../${name}`, import.meta.url), 'utf8')
const compile = (text) => ts.transpileModule(text, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText
const snapshot = (value) => JSON.parse(JSON.stringify(value))
const progress = (patch = {}) => ({ stage: 'generating', completedShots: 2,
  totalShots: 15, durationSeconds: 30, elapsedMs: 15_000, ...patch })

// Execute the actual callbacks without starting the server or mounting the UI.
function callback(file, name, context) {
  const ast = ts.createSourceFile(file, source(file), ts.ScriptTarget.Latest, true,
    file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
  const found = []
  const visit = (node) => {
    if (ts.isPropertyAssignment(node) && node.name.getText(ast) === name) found.push(node.initializer.getText(ast))
    ts.forEachChild(node, visit)
  }
  visit(ast)
  assert.equal(found.length, 1, `${file} has one ${name} callback`)
  const sandbox = vm.isContext(context) ? context : vm.createContext({ exports: {}, ...context })
  vm.runInContext(compile(`exports.callback = ${found[0]}`), sandbox)
  return { call: sandbox.exports.callback, context: sandbox }
}

function serverHarness() {
  const emitted = []
  const origin = { turnId: 'a1' }
  const harness = callback('bridge/server.mjs', 'nativeVideoProgress', {
    closed: false, socket: { readyState: 1, OPEN: 1 }, activeNeuralOrigin: origin,
    ownsNeuralObservation: (candidate, active) => candidate === origin && candidate === active,
    send: (frame) => emitted.push(snapshot(frame)),
  })
  return { ...harness, origin, emitted }
}

function clock() {
  let time = 0
  let next = 0
  const pending = new Map()
  return {
    now: () => time,
    setTimeout(fn, ms) { const id = ++next; pending.set(id, { fn, at: time + ms }); return id },
    clearTimeout(id) { pending.delete(id) },
    advance(ms) {
      const end = time + ms
      while (true) {
        const entry = [...pending].filter(([, value]) => value.at <= end).sort((a, b) => a[1].at - b[1].at)[0]
        if (!entry) break
        const [id, value] = entry
        pending.delete(id)
        time = value.at
        value.fn()
      }
      time = end
    },
  }
}

async function clientHarness() {
  const time = clock()
  const sockets = []
  const neural = []
  class Socket {
    static OPEN = 1
    readyState = 0
    listeners = new Map()
    sent = []
    constructor() { sockets.push(this) }
    addEventListener(type, fn) {
      if (!this.listeners.has(type)) this.listeners.set(type, new Set())
      this.listeners.get(type).add(fn)
    }
    removeEventListener(type, fn) { this.listeners.get(type)?.delete(fn) }
    send(text) { this.sent.push(JSON.parse(text)) }
    open() { this.readyState = 1; this.onopen?.() }
    frame(value) { for (const fn of [...(this.listeners.get('message') ?? [])]) fn({ data: JSON.stringify(value) }) }
    close() {
      this.readyState = 3
      this.onclose?.()
      for (const fn of [...(this.listeners.get('close') ?? [])]) fn({})
    }
  }
  const context = vm.createContext({
    exports: {}, console, WebSocket: Socket, performance: { now: time.now },
    setTimeout: time.setTimeout, clearTimeout: time.clearTimeout, location: { port: '43210' },
    require: (id) => {
      if (id.endsWith('/config')) return { BRIDGE_WS_URL: 'ws://127.0.0.1:43210' }
      if (id.endsWith('/neural-signals')) return {
        observeBridgeNeuralSignal: (...args) => neural.push(args), clearNeuralSignals() {},
      }
      if (id.endsWith('/neural-event-contract.mjs')) return { createNeuralEventLedger: () => ({ close() {} }) }
      if (id.endsWith('/personality/profile.mjs')) return { validPersonalitySnapshot: () => false }
      if (id.endsWith('/tts')) return { setSpeechPersonality() {} }
      if (id.endsWith('/screen-perception-contract.mjs')) return {}
      throw new Error(`Unexpected dependency ${id}`)
    },
  })
  context.window = context
  vm.runInContext(compile(source('src/lib/bridge.ts')), context)
  const api = context.exports
  const warming = api.warmBridge()
  const socket = sockets[0]
  socket.open()
  socket.frame({ type: 'ready', servers: [], models: [], efforts: [] })
  await warming
  async function ask(extra = {}) {
    const events = { text: [], tools: [], progress: [] }
    let settled = false
    const reply = api.ask('Create a local video', {
      onText: (value) => events.text.push(value), onTool: (value) => events.tools.push(value),
      onProgress: (value) => events.progress.push(snapshot(value)), ...extra,
    })
    reply.then(() => { settled = true }, () => { settled = true })
    await Promise.resolve()
    const id = socket.sent.findLast((frame) => frame.type === 'ask').id
    return { id, reply, events, isSettled: () => settled }
  }
  return { api, socket, ask, time, neural }
}

test('server emits only validated current-origin progress, never caller text', () => {
  const h = serverHarness()
  h.call(progress({ detail: 'untrusted free text' }), h.origin)
  assert.deepEqual(h.emitted, [{ type: 'video_progress', ask: 'a1', progress: progress() }])
  h.call(progress(), { turnId: 'a1' })
  h.call(progress(), { turnId: 'old-turn' })
  h.context.activeNeuralOrigin = null
  h.call(progress(), h.origin)
  assert.equal(h.emitted.length, 1)
})

test('server rejects malformed progress and permits long resource-approved work', () => {
  const h = serverHarness()
  for (const invalid of [null, [], 'working', progress({ stage: 'done' }), progress({ stage: 'failed' }),
    progress({ totalShots: 0 }), progress({ totalShots: 1.2 }), progress({ totalShots: Number.MAX_SAFE_INTEGER + 1 }),
    progress({ completedShots: -1 }), progress({ completedShots: 16 }), progress({ completedShots: '2' }),
    progress({ durationSeconds: Infinity }), progress({ durationSeconds: 0 }),
    progress({ elapsedMs: -1 }), progress({ elapsedMs: 2.5 })]) h.call(invalid, h.origin)
  assert.equal(h.emitted.length, 0)
  h.call(progress({ totalShots: 3601, durationSeconds: 7202, elapsedMs: 172_800_000 }), h.origin)
  assert.equal(h.emitted.length, 1)
})

test('server drops closed-origin/disconnected telemetry and send races cannot fail generation', () => {
  const h = serverHarness()
  h.context.closed = true
  h.call(progress(), h.origin)
  h.context.closed = false
  h.context.socket.readyState = 3
  h.call(progress(), h.origin)
  assert.equal(h.emitted.length, 0)
  h.context.socket.readyState = 1
  h.context.send = () => { throw new Error('socket closed during send') }
  assert.doesNotThrow(() => h.call(progress(), h.origin))
})

test('validated heartbeats keep a video turn alive beyond 120 seconds without success, text or tool events', async () => {
  const h = await clientHarness()
  const turn = await h.ask()
  for (let shot = 0; shot < 3; shot += 1) {
    h.time.advance(119_999)
    h.socket.frame({ type: 'video_progress', ask: turn.id, progress: progress({ completedShots: shot }) })
    await Promise.resolve()
    assert.equal(turn.isSettled(), false)
  }
  assert.equal(h.time.now(), 359_997)
  assert.deepEqual(turn.events.text, [])
  assert.deepEqual(turn.events.tools, [])
  assert.equal(h.neural.length, 0, 'telemetry does not masquerade as a Neuralese action or success')
  assert.equal(turn.events.progress.length, 3)
  h.socket.frame({ type: 'done', ask: turn.id, text: 'Verified video ready.' })
  assert.deepEqual(snapshot(await turn.reply), { text: 'Verified video ready.', tools: [] })
  assert.equal(turn.events.progress.at(-1), null)
})

test('stale, unscoped and malformed progress never display or extend the idle timeout', async () => {
  const h = await clientHarness()
  const turn = await h.ask()
  const rejection = assert.rejects(turn.reply, /bridge went quiet/)
  h.time.advance(119_999)
  h.socket.frame({ type: 'video_progress', ask: 'a-previous', progress: progress() })
  h.socket.frame({ type: 'video_progress', progress: progress() })
  for (const invalid of [null, [], progress({ stage: 'done' }), progress({ totalShots: 0 }),
    progress({ completedShots: 16 }), progress({ durationSeconds: -1 }), progress({ elapsedMs: '15000' })]) {
    h.socket.frame({ type: 'video_progress', ask: turn.id, progress: invalid })
  }
  h.time.advance(1)
  await rejection
  assert.deepEqual(turn.events.progress, [])
  assert.deepEqual(turn.events.text, [])
  assert.deepEqual(turn.events.tools, [])
})

test('normal tool and answer delivery survive progress; rendering exceptions do not fail the turn', async () => {
  const h = await clientHarness()
  const turn = await h.ask({ onProgress: () => { throw new Error('renderer unavailable') } })
  h.socket.frame({ type: 'video_progress', ask: turn.id, progress: progress() })
  h.socket.frame({ type: 'tool', ask: turn.id, name: 'video_generate' })
  h.socket.frame({ type: 'text', ask: turn.id, delta: 'Actual answer.' })
  h.socket.frame({ type: 'done', ask: turn.id })
  assert.deepEqual(snapshot(await turn.reply), { text: 'Actual answer.', tools: ['video_generate'] })
  assert.deepEqual(turn.events.text, ['Actual answer.'])
  assert.equal(turn.events.tools.length, 1)
})

test('cancel and supersession clear progress and late previous-turn heartbeats cannot reach the next turn', async () => {
  const h = await clientHarness()
  const first = await h.ask()
  h.socket.frame({ type: 'video_progress', ask: first.id, progress: progress() })
  const second = await h.ask()
  await first.reply
  assert.equal(first.events.progress.at(-1), null)
  h.socket.frame({ type: 'video_progress', ask: first.id, progress: progress() })
  assert.deepEqual(second.events.progress, [])
  h.socket.frame({ type: 'video_progress', ask: second.id, progress: progress() })
  h.api.cancel()
  await second.reply
  assert.equal(second.events.progress.at(-1), null)
  assert.equal(h.socket.sent.filter((frame) => frame.type === 'interrupt').length, 2)
  h.socket.frame({ type: 'video_progress', ask: second.id, progress: progress() })
  assert.equal(second.events.progress.length, 2)
})

test('error and disconnect remove progress without declaring a result', async () => {
  for (const reason of ['error', 'close']) {
    const h = await clientHarness()
    const turn = await h.ask()
    const rejection = assert.rejects(turn.reply, reason === 'error' ? /render failed/ : /disconnected/)
    h.socket.frame({ type: 'video_progress', ask: turn.id, progress: progress() })
    if (reason === 'error') h.socket.frame({ type: 'error', ask: turn.id, message: 'render failed' })
    else h.socket.close()
    await rejection
    assert.equal(turn.events.progress.at(-1), null)
    assert.deepEqual(turn.events.text, [])
  }
})

function appHarness() {
  const events = []
  const h = callback('src/App.tsx', 'onProgress', {
    stale: () => false, started: false, videoProgressActive: false,
    store: { getState: () => ({
      setPhase: (value) => events.push(['phase', value]),
      setActiveTool: (value) => events.push(['tool', value]),
      pushTurn: () => { throw new Error('Progress must not invent transcript entries') },
    }) },
    sfx: { play: () => { throw new Error('Progress must not chime') } },
    spk: new Proxy({}, { get: () => () => { throw new Error('Progress must not speak') } }),
  })
  return { ...h, events }
}

test('App progress labels show active shot/phase and long durations without speech, chimes or completion', () => {
  const h = appHarness()
  h.call(progress())
  assert.deepEqual(h.events, [['phase', 'tooling'], ['tool', 'Generating shot 3/15 for a 30-second video · elapsed 15s']])
  h.call(progress({ stage: 'assembling' }))
  assert.deepEqual(h.events.at(-1), ['tool', 'Assembling 15 shots into a 30-second video · elapsed 15s'])
  h.call(progress({ stage: 'verifying' }))
  assert.deepEqual(h.events.at(-1), ['tool', 'Checking the 30-second video · elapsed 15s'])
  h.call(progress({ stage: 'preparing', totalShots: 3600, durationSeconds: 7200 }))
  assert.deepEqual(h.events.at(-1), ['tool', 'Preparing a 2-hour local video · elapsed 15s'])
  h.call(null)
  assert.deepEqual(h.events.at(-1), ['tool', null])
  assert.equal(h.context.videoProgressActive, false)
})

test('App drops stale progress and marks work after the initial spoken notice', () => {
  const h = appHarness()
  h.context.stale = () => true
  h.call(progress())
  assert.deepEqual(h.events, [])
  h.context.stale = () => false
  h.context.started = true
  h.call(progress())
  assert.deepEqual(h.events, [['phase', 'tooling'], ['tool', 'Generating shot 3/15 for a 30-second video · elapsed 15s']])
})

test('App returns to speaking for the final video answer without creating a second transcript entry', () => {
  const h = appHarness()
  const transcript = []
  const speech = []
  h.context.turnId = 'video-turn'
  h.context.store = { getState: () => ({
    setPhase: (value) => h.events.push(['phase', value]),
    setActiveTool: (value) => h.events.push(['tool', value]),
    pushTurn: (turn) => transcript.push(snapshot(turn)),
    appendToLastTurn: (delta) => { transcript.at(-1).text += delta },
  }) }
  h.context.music = { working() {} }
  h.context.spk = { push: (delta) => speech.push(delta) }
  const onText = callback('src/App.tsx', 'onText', h.context).call
  onText('I am generating the video. ')
  assert.equal(h.context.started, true)
  assert.deepEqual(h.events.slice(-2), [['phase', 'speaking'], ['tool', null]])
  for (const stage of ['preparing', 'generating', 'assembling', 'verifying']) {
    h.call(progress({ stage }))
    assert.deepEqual(h.events.at(-2), ['phase', 'tooling'])
    assert.equal(h.context.videoProgressActive, true)
  }
  onText('The verified video is ready.')
  assert.deepEqual(h.events.slice(-2), [['phase', 'speaking'], ['tool', null]])
  assert.equal(h.context.videoProgressActive, false)
  assert.deepEqual(transcript, [{ id: 'video-turn', role: 'nori', text: 'I am generating the video. The verified video is ready.' }])
  assert.deepEqual(speech, ['I am generating the video. ', 'The verified video is ready.'])
  const finishedEvents = [...h.events]
  h.call(null)
  assert.deepEqual(h.events, finishedEvents, 'cleanup must not undo the final speaking state')
})

test('App elapsed time visibly advances while the same shot runs, without an ETA or speech', () => {
  const h = appHarness()
  const sameShot = { completedShots: 0, totalShots: 3, durationSeconds: 5 }
  for (const [elapsedMs, expected] of [[0, '0s'], [300_000, '5m 0s'], [315_000, '5m 15s'],
    [3_600_000, '1h 0m 0s'], [90_315_999, '25h 5m 15s']]) {
    h.call(progress({ ...sameShot, elapsedMs }))
    assert.deepEqual(h.events.at(-1), ['tool', `Generating shot 1/3 for a 5-second video · elapsed ${expected}`])
  }
})

test('App keeps normal tool sound/filler behavior and progress cleanup cannot clear that later tool', () => {
  const h = appHarness()
  const sound = []
  const speech = []
  h.context.sfx = { play: (value) => sound.push(value) }
  h.context.spk = { say: (value) => speech.push(value) }
  h.context.forTool = (name) => `Working on ${name}`
  h.context.filled = false
  const onTool = callback('src/App.tsx', 'onTool', h.context).call
  h.call(progress())
  h.call(progress({ completedShots: 3 }))
  assert.deepEqual(sound, [])
  assert.deepEqual(speech, [])
  onTool('Read output')
  assert.deepEqual(sound, ['tool'])
  assert.deepEqual(speech, ['Working on Read output'])
  assert.equal(h.context.videoProgressActive, false)
  const lastEvents = [...h.events]
  h.call(null)
  assert.deepEqual(h.events, lastEvents, 'progress cleanup leaves the new ordinary tool label intact')
})
