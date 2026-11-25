/**
 * Regression cover for the four pre-integration defects found by independent
 * review in CLINE_NATIVE_REPLACEMENT_REVIEW_2026-10-01.txt.
 *
 *   1. Wake matching wrongly rejected ordinary contractions.
 *   2. A command returned by feed() was emitted a second time by settle().
 *   3. No transcript/aggregate/deadline bound existed.
 *   4. A nameless MCP descriptor was accepted and callable as `undefined`.
 *
 * Separate from tests/nori-wake-controller.test.mjs (behaviour as originally
 * specified) so a reviewer can tell original coverage from defect coverage.
 * Nothing here relaxes an expectation to make a defect pass: every case asserts
 * the CORRECT behaviour, and the parity cases import the shipped renderer
 * rather than restating this module's own beliefs.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { WAKE as rendererWake, afterWake as rendererAfterWake } from '../src/lib/wake.ts'
import { createWakeController, isWake, afterWake } from '../bridge/nori-wake.mjs'
import { createMcpToolServer, NoriMcpDefinitionError } from '../bridge/nori-mcp.mjs'

/** Deterministic clock so timing assertions never depend on wall time. */
function clock(start = 10_000) {
  let t = start
  return { now: () => t, advance: (ms) => { t += ms } }
}

// ---------------------------------------------------------------------------
// Defect 1 - contractions are ordinary speech, not possessive mentions
// ---------------------------------------------------------------------------

test('defect 1: a contraction after a valid address does not veto the wake', () => {
  // The exact sentence the reviewer reported as rejected.
  const spoken = "Nori, what's the weather?"
  assert.equal(rendererWake.test(spoken), true, 'shipped renderer accepts it')
  assert.equal(isWake(spoken), true, 'headless must match the renderer')
  assert.equal(afterWake(spoken), rendererAfterWake(spoken))
  assert.equal(afterWake(spoken), "what's the weather?")
})

test('defect 1: many ordinary contractions stay accepted', () => {
  const corpus = [
    "Nori, what's the weather?",
    "Nori what's up",
    "Nori, where's my file?",
    "Nori, it's cold in here",
    "Nori, don't turn the lights off",
    "Nori, I'm not sure about that one",
    "Nori, who's coming to lunch?",
    "Nori, let's check the schedule",
    "Nori, that's the one I meant",
  ]
  for (const spoken of corpus) {
    assert.equal(isWake(spoken), rendererWake.test(spoken), `isWake(${spoken})`)
    assert.equal(afterWake(spoken), rendererAfterWake(spoken), `afterWake(${spoken})`)
    assert.equal(isWake(spoken), true, `${spoken} should be an address`)
  }
})

test('defect 1: a possessive directly on the name is still refused', () => {
  // The guard must survive the fix. It is scoped to the name, not the sentence.
  for (const said of ["Nori's job", 'Nori\u2019s settings', 'norris files']) {
    assert.equal(isWake(said), false, said)
    assert.equal(isWake(said), rendererWake.test(said), `parity for ${said}`)
  }
  // An explicit address wins even when a possessive appears later.
  const mixed = "hey Nori, what's Nori's job?"
  assert.equal(isWake(mixed), rendererWake.test(mixed))
  assert.equal(isWake(mixed), true)
})

test('defect 1: full behavioural parity with the renderer across a mixed corpus', () => {
  const CORPUS = [
    'hey nori', 'nori', 'okay nori', 'norrie', 'norry hi', 'yo nori', 'nori',
    "Nori, what's the weather?", "nori, it's cold", "nori's job",
    "hey nori, what's nori's job?", 'the nori of it', 'minor detail',
    'northern lights', 'canary', 'noriko', 'Travis', 'Jervis', "Java's",
    'nori, open my notes.', 'nori open my notes', '', '   ',
  ]
  for (const said of CORPUS) {
    assert.equal(isWake(said), rendererWake.test(said), `isWake parity: ${JSON.stringify(said)}`)
    assert.equal(afterWake(said), rendererAfterWake(said), `afterWake parity: ${JSON.stringify(said)}`)
  }
})
// ---------------------------------------------------------------------------
// Defect 2 - a dispatched command must be dispatched exactly once
// ---------------------------------------------------------------------------

test('defect 2: feed then settle does not emit the same command twice', () => {
  // Exact reproduction from the review.
  let t = 10_000
  const c = createWakeController({ now: () => t })
  const immediate = c.feed('Hey Nori, open my notes.')
  t += 1000
  const later = c.settle()

  assert.equal(immediate.kind, 'command')
  assert.equal(immediate.text, 'open my notes.')
  // The reviewer observed a second identical command here.
  assert.notEqual(later.kind, 'command', 'settle must not re-emit a dispatched command')
  assert.equal(later.reason, 'nothing_held')
})

test('defect 2: repeated feed and settle cycles never duplicate a command', () => {
  const time = clock()
  const c = createWakeController({ now: time.now })
  const dispatched = []

  for (let turn = 0; turn < 5; turn += 1) {
    time.advance(2000) // clear the wake debounce between turns
    const out = c.feed(`Nori, do task ${turn}.`)
    if (out.kind === 'command') dispatched.push(out.text)
    time.advance(1000)
    const settled = c.settle()
    if (settled.kind === 'command') dispatched.push(settled.text)
  }

  assert.deepEqual(dispatched, [
    'do task 0.', 'do task 1.', 'do task 2.', 'do task 3.', 'do task 4.',
  ])
  // Five turns in, five commands out. No duplicates, no losses.
  assert.equal(new Set(dispatched).size, 5)
  assert.equal(c.describe().utteranceCount, 5)
})

test('defect 2: cancel and settle after dispatch stay quiet', () => {
  const time = clock()
  const c = createWakeController({ now: time.now })
  c.feed('Nori, open my notes.')
  assert.equal(c.held(), false, 'a dispatched command must leave nothing held')
  assert.equal(c.cancel().reason, 'nothing_held')
  time.advance(5000)
  assert.equal(c.settle().reason, 'nothing_held')
  assert.equal(c.describe().utteranceCount, 1)
})

test('defect 2: an incomplete thought still settles exactly once', () => {
  const time = clock()
  // Mode must be COMMAND for the segment to be treated as a command piece; in
  // wake mode it is correctly dropped as "not addressed to Nori".
  const c = createWakeController({ mode: () => 'command', now: time.now })
  assert.equal(c.feed('what is the').kind, 'held')
  time.advance(1000)
  const first = c.settle()
  assert.equal(first.kind, 'command')
  assert.equal(first.text, 'what is the')
  // Immediately again, and much later: nothing left.
  assert.equal(c.settle().reason, 'nothing_held')
  time.advance(60_000)
  assert.equal(c.settle().reason, 'nothing_held')
  assert.equal(c.describe().utteranceCount, 1)
})

test('defect 2: a mode change between feed and settle still dispatches once', () => {
  const time = clock()
  const state = { mode: 'wake' }
  const c = createWakeController({ mode: () => state.mode, now: time.now })
  c.feed('Nori')
  state.mode = 'command'
  assert.equal(c.feed('turn the lights down.').kind, 'command')
  // Guard mode mid-flight must not resurface the old text either.
  state.mode = 'guard'
  const interrupted = c.feed('actually stop')
  assert.equal(interrupted.kind, 'command')
  assert.equal(interrupted.interrupted, true)
  time.advance(10_000)
  assert.equal(c.settle().reason, 'nothing_held')
  assert.equal(c.describe().utteranceCount, 2)
})
// ---------------------------------------------------------------------------
// Defect 3 - finite transcript, aggregate and deadline bounds
// ---------------------------------------------------------------------------

test('defect 3: an oversized transcript is refused and nothing is held', () => {
  // Exact reproduction from the review: 1 MiB used to come back as held text.
  const c = createWakeController({ mode: () => 'command' })
  const out = c.feed('x'.repeat(1_048_576))
  assert.equal(out.kind, 'dropped')
  assert.equal(out.reason, 'transcript_too_long')
  assert.equal(out.text, undefined, 'an oversize segment must not be echoed back')
  assert.equal(c.held(), false)
  assert.equal(c.describe().lastError, 'transcript_too_long')
})

test('defect 3: the controller recovers and works normally after a refusal', () => {
  const c = createWakeController({ mode: () => 'command' })
  c.feed('x'.repeat(1_048_576))
  // The next legitimate segment must work normally.
  const good = c.feed('turn the lights down.')
  assert.equal(good.kind, 'command')
  assert.equal(good.text, 'turn the lights down.')
  assert.equal(c.describe().lastError, '')
  assert.equal(c.describe().utteranceCount, 1)
})

test('defect 3: an oversize segment discards a half-built thought', () => {
  const time = clock()
  const state = { mode: 'wake' }
  const c = createWakeController({ mode: () => state.mode, now: time.now })
  c.feed('Nori')
  state.mode = 'command'
  c.feed('what is the')
  assert.equal(c.held(), true)
  // The bad segment must not be stitched onto good text.
  const out = c.feed('y'.repeat(5000))
  assert.equal(out.reason, 'transcript_too_long')
  assert.equal(c.held(), false, 'held text must be discarded, not merged')
  time.advance(60_000)
  assert.equal(c.settle().reason, 'nothing_held')
})

test('defect 3: the aggregate held-text ceiling is enforced across segments', () => {
  const c = createWakeController({ mode: () => 'command', maxHeldCharacters: 200 })
  // Each segment is legal on its own; together they exceed the aggregate cap.
  let reason = ''
  for (let i = 0; i < 20 && !reason; i += 1) {
    const out = c.feed(`tell me about the thing number ${i}`)
    if (out.kind === 'dropped') reason = out.reason
  }
  assert.equal(reason, 'held_text_too_long')
  assert.equal(c.held(), false, 'the whole buffer is discarded, never truncated')
})

test('defect 3: an absolute hold deadline releases a thought idle time never would', () => {
  const time = clock()
  const early = createWakeController({
    mode: () => 'command', now: time.now, settleMs: 700, maxHoldMs: 5000,
  })
  early.feed('what is the')
  // Past idle time but under the absolute deadline: an ordinary idle release.
  time.advance(1000)
  const settledEarly = early.settle()
  assert.equal(settledEarly.kind, 'command')
  assert.equal(settledEarly.release, 'idle')
  assert.equal(settledEarly.heldForMs, 1000)

  // The case idle time structurally cannot cover: continuous speech with short
  // gaps, where settleMs never elapses but total hold time does.
  const forced = createWakeController({
    mode: () => 'command', now: time.now, settleMs: 6000, maxHoldMs: 5000,
  })
  // settleMs (6000) deliberately EXCEEDS maxHoldMs (5000), so idle time can
  // never be what releases this thought. Only the absolute ceiling can.
  forced.feed('what is the')
  for (let i = 0; i < 20; i += 1) {
    time.advance(400) // each gap is far under settleMs
    const out = forced.feed(`more ${i}`)
    assert.equal(out.kind, 'held', `segment ${i} should still be held`)
  }
  const released = forced.settle()
  assert.equal(released.kind, 'command')
  assert.equal(released.release, 'hold_deadline')
  assert.equal(released.heldForMs >= 5000, true)
  assert.equal(released.text.startsWith('what is the'), true)

  // Decisive case: a ceiling so short that settleMs can NEVER have elapsed.
  // Idle time is structurally incapable of releasing this thought, so only the
  // absolute deadline can.
  const proven = createWakeController({
    mode: () => 'command', now: time.now, settleMs: 3_600_000, maxHoldMs: 3000,
  })
  proven.feed('what is the')
  time.advance(1000)
  assert.equal(proven.feed('still thinking').kind, 'held')
  time.advance(2500)
  const byCeiling = proven.settle()
  assert.equal(byCeiling.kind, 'command')
  assert.equal(byCeiling.release, 'hold_deadline')
  assert.equal(byCeiling.heldForMs, 3500)
  assert.equal(byCeiling.text, 'what is the still thinking')
})

test('defect 3: bounds are validated and reported, not just enforced', () => {
  assert.throws(() => createWakeController({ maxSegmentCharacters: 0 }), /positive finite/)
  assert.throws(() => createWakeController({ maxHeldCharacters: -1 }), /positive finite/)
  assert.throws(() => createWakeController({ maxHoldMs: Number.NaN }), /positive finite/)
  const described = createWakeController().describe()
  assert.equal(described.wake.maxSegmentCharacters, 4096)
  assert.equal(described.wake.maxHeldCharacters, 8192)
  assert.equal(described.wake.maxHoldMs, 15000)
  // A custom bound must be honoured, not silently replaced by the default.
  assert.equal(createWakeController({ maxSegmentCharacters: 10 }).describe().wake.maxSegmentCharacters, 10)
})

test('defect 3: retained transcript text is bounded, not the whole segment', () => {
  const c = createWakeController({ mode: () => 'command' })
  c.feed('y'.repeat(4000))
  assert.equal(c.describe().lastHeard.length, 80)
})
// ---------------------------------------------------------------------------
// Defect 4 - malformed MCP descriptors must be refused
// ---------------------------------------------------------------------------

test('defect 4: a descriptor with no name is refused, not callable as undefined', () => {
  // Exact reproduction from the review.
  assert.throws(
    () => createMcpToolServer({
      name: 'n', version: '1', tools: [{ call: async () => 'synthetic-only' }],
    }),
    NoriMcpDefinitionError,
  )
})

test('defect 4: name, description, schema and handler are all required', () => {
  const base = {
    name: 'probe', description: 'A probe.', inputSchema: { type: 'object', properties: {} },
    call: async () => 'ok',
  }
  const cases = {
    'missing name': (t) => delete t.name,
    'blank name': (t) => { t.name = '   '; },
    'malformed name': (t) => { t.name = 'Bad Name'; },
    'non-string name': (t) => { t.name = 42; },
    'missing description': (t) => delete t.description,
    'blank description': (t) => { t.description = ''; },
    'missing schema': (t) => delete t.inputSchema,
    'array schema': (t) => { t.inputSchema = []; },
    'non-object schema type': (t) => { t.inputSchema = { type: 'string' }; },
    'array properties': (t) => { t.inputSchema = { type: 'object', properties: [] }; },
    'missing handler': (t) => delete t.call,
    'non-function handler': (t) => { t.call = 'not a function'; },
  }
  for (const [label, mutate] of Object.entries(cases)) {
    const descriptor = { ...base }
    mutate(descriptor)
    assert.throws(
      () => createMcpToolServer({ name: 'n', version: '1', tools: [descriptor] }),
      NoriMcpDefinitionError,
      `${label} should be refused`,
    )
  }
  // The unmodified descriptor is accepted, so the refusals are meaningful.
  assert.deepEqual(
    createMcpToolServer({ name: 'n', version: '1', tools: [base] }).toolNames(),
    ['probe'],
  )
})

test('defect 4: duplicate names are refused and callTool needs a real name', async () => {
  const build = (name) => ({
    name, description: 'A probe.', inputSchema: { type: 'object', properties: {} },
    call: async () => name,
  })
  assert.throws(
    () => createMcpToolServer({ name: 'n', version: '1', tools: [build('dup'), build('dup')] }),
    /twice/,
  )
  const server = createMcpToolServer({ name: 'n', version: '1', tools: [build('probe')] })
  // Missing, empty and non-string names are all refused, not coerced.
  for (const bad of [undefined, null, '', 0, {}, []]) {
    await assert.rejects(() => server.callTool(bad, {}), NoriMcpDefinitionError)
  }
  assert.equal(await server.callTool('probe', {}), 'probe')
})

test('defect 4: tool() provenance is reported honestly', async () => {
  const { z } = await import('zod')
  const { tool } = await import('../bridge/nori-mcp.mjs')
  const built = tool('probe', 'A probe.', { count: z.number().optional() }, async () => 'ok')
  const server = createMcpToolServer({ name: 'n', version: '1', tools: [built] })
  assert.deepEqual(server.unprovenancedTools(), [], 'tool() output has provenance')

  // A hand-built but fully valid descriptor is accepted and reported honestly.
  const handmade = {
    name: 'hand', description: 'Built by hand.',
    inputSchema: { type: 'object', properties: {} }, call: async () => 'ok',
  }
  const mixed = createMcpToolServer({ name: 'n', version: '1', tools: [built, handmade] })
  assert.deepEqual(mixed.unprovenancedTools(), ['n/hand'])
  assert.equal(await mixed.callTool('hand', {}), 'ok')
})

test('defect 4: all 23 shipped adapter contracts still build and validate', async () => {
  const servers = {
    panels: (await import('../bridge/panels.mjs')).displayServer(() => {}, () => {}, () => {}),
    ui: (await import('../bridge/ui.mjs')).uiServer(() => {}),
    vision: (await import('../bridge/vision.mjs')).visionServer(async () => ({})),
    chrome: (await import('../bridge/chrome.mjs')).chromeServer({ allowWrites: false }),
  }
  let total = 0
  for (const [name, server] of Object.entries(servers)) {
    for (const entry of server.tools) {
      assert.equal(entry.inputSchema.type, 'object', `${name}/${entry.name}`)
      assert.ok(entry.description.length > 0, `${name}/${entry.name}`)
      assert.equal(typeof entry.call, 'function', `${name}/${entry.name}`)
    }
    // Real adapter tools must all carry module provenance.
    assert.deepEqual(server.unprovenancedTools(), [], name)
    total += server.tools.length
  }
  assert.equal(total, 23, 'the descriptor change must not drop any tool')
})
