import test from 'node:test'
import assert from 'node:assert/strict'
// The renderer module is the shipped implementation of wake matching. Importing
// it here is what makes the parity assertion below meaningful rather than a
// restatement of this module's own beliefs.
import {
  WAKE as rendererWake,
  afterWake as rendererAfterWake,
} from '../src/lib/wake.ts'
import {
  VOICE_MODE,
  createWakeController,
  isWake,
  afterWake,
  looksComplete,
  NoriWakeError,
} from '../bridge/nori-wake.mjs'

/** The renderer's notion of "this was addressed to Nori". */
const rendererIsWake = (said) => rendererWake.test(said)

// A clock the test drives by hand. Several of these cases exist purely because
// of what the voice loop does with time, so nothing here depends on wall time.
function clock(start = 1_000_000) {
  let t = start
  return { now: () => t, advance: (ms) => { t += ms } }
}

/** Controller pinned to one mode, with a manual clock. */
function fixed({ mode = VOICE_MODE.WAKE, blocked = false } = {}) {
  const time = clock()
  const c = createWakeController({
    mode: () => mode,
    blocked: () => blocked,
    now: time.now,
  })
  return { c, time }
}

/** Controller whose mode can be switched mid-test, as the app does. */
function switchable(initialMode = VOICE_MODE.WAKE) {
  const time = clock()
  const state = { mode: initialMode }
  const c = createWakeController({ mode: () => state.mode, now: time.now })
  return { c, time, set: (next) => { state.mode = next } }
}

// ---------------------------------------------------------------------------
// Wake matching
// ---------------------------------------------------------------------------

test('wake matching accepts addresses and refuses near misses', () => {
  for (const said of ['hey nori', 'nori', 'okay nori', 'norrie', 'norry hi', 'yo nori']) {
    assert.equal(isWake(said), true, said)
  }
  for (const said of ['minor detail', 'northern lights', 'canary', 'noriko', '']) {
    assert.equal(isWake(said), false, JSON.stringify(said))
  }
  // Legacy assistant names must not wake her.
  for (const said of ['Travis', 'Jervis', 'Jarvys', 'Jarv', "Java's"]) {
    assert.equal(isWake(said), false, said)
  }
  // A possessive is a mention, not an address...
  assert.equal(isWake("nori's job"), false)
  // ...but an explicit address in the same breath still counts.
  assert.equal(isWake("hey nori, what's nori's job"), true)
})

test('wake matching refuses non-strings instead of throwing', () => {
  for (const bad of [undefined, null, 42, {}, []]) {
    assert.equal(isWake(bad), false, JSON.stringify(bad))
    assert.equal(afterWake(bad), '')
    assert.equal(looksComplete(bad), false)
  }
})

test('the trailing command is one breath, not a second turn', () => {
  assert.equal(afterWake('nori, what is the weather'), 'what is the weather')
  assert.equal(afterWake('hey nori what is the weather'), 'what is the weather')
  assert.equal(afterWake('nori'), '')
})

test('this module matches the renderer wake definition exactly', () => {
  // The renderer ships today and its WAKE regex is unanchored: a name anywhere
  // in the segment counts, and only the possessive lookahead excludes it. The
  // bridge copy must behave identically rather than being stricter, or the two
  // halves of the product would disagree about when Nori is addressed.
  // Behavioural parity with the renderer, which is what actually ships today.
  // The bridge copy must not be stricter or looser, or the two halves of the
  // product would disagree about when Nori has been addressed.
  const CORPUS = [
    'hey nori', 'nori', 'okay nori', 'norrie', 'norry hi', 'yo nori',
    'nori, what is the weather', 'nori', 'minor detail', 'northern lights',
    'canary', 'noriko', 'Travis', 'Jervis', "Java's", "nori's job",
    "hey nori, what's nori's job", 'the nori of it', 'just talking about nori',
    '', '   ',
  ]
  for (const said of CORPUS) {
    assert.equal(isWake(said), rendererIsWake(said), `isWake(${JSON.stringify(said)})`)
    assert.equal(afterWake(said), rendererAfterWake(said), `afterWake(${JSON.stringify(said)})`)
  }
})

// ---------------------------------------------------------------------------
// Incomplete-thought handling
// ---------------------------------------------------------------------------

test('a trailing function word is not a finished thought', () => {
  assert.equal(looksComplete('what is the weather in'), false)
  assert.equal(looksComplete('I was thinking about the'), false)
  assert.equal(looksComplete('and then she said'), false)
// ---------------------------------------------------------------------------
// The state machine
// ---------------------------------------------------------------------------

test('a bare name wakes; a trailing command is handled in one turn', () => {
  const { c, time } = fixed()
  assert.deepEqual(c.feed('hey nori'), { kind: 'wake', trailing: '' })
  // Past the debounce, so this is a genuinely new utterance rather than
  // another partial of the same breath.
  time.advance(2000)
  const spoken = c.feed('nori, what is the weather')
  assert.equal(spoken.kind, 'command')
  assert.equal(spoken.text, 'what is the weather')
  assert.equal(spoken.wake, true)
})

test('one utterance yields several partials but only one wake', () => {
  const { c, time } = fixed()
  assert.equal(c.feed('hey nori').kind, 'wake')
  time.advance(100)
  // Still inside the debounce window: the same breath, not a new one.
  assert.equal(c.feed('nori').reason, 'wake_debounced')
  time.advance(2000)
  assert.equal(c.feed('nori').kind, 'wake')
})

test('speech that is not addressed to Nori is dropped, not answered', () => {
  const { c } = fixed()
  assert.deepEqual(c.feed('what is the weather'), {
    kind: 'dropped',
    reason: 'not_addressed_to_nori',
  })
  assert.equal(c.feed('   ').reason, 'nothing_intelligible')
  assert.equal(c.feed(undefined).reason, 'transcript_not_text')
})

test('a held thought survives a mid-sentence pause and fires once quiet', () => {
  const { c, time, set } = switchable()
  c.feed('nori')
  set(VOICE_MODE.COMMAND)
  assert.equal(c.feed("what's the weather in").kind, 'held')
  assert.equal(c.held(), true)
  // Not quiet long enough yet.
  time.advance(100)
  assert.equal(c.settle().reason, 'still_settling')
  time.advance(800)
  const fired = c.settle()
  assert.equal(fired.kind, 'command')
  assert.equal(fired.text, "what's the weather in")
  assert.equal(c.held(), false)
  // Nothing left to fire.
  assert.equal(c.settle().reason, 'nothing_held')
})

test('a complete sentence fires immediately with no settling penalty', () => {
  const { c, set } = switchable()
  c.feed('nori')
  set(VOICE_MODE.COMMAND)
  const out = c.feed('open the pod bay doors.')
  assert.equal(out.kind, 'command')
  assert.equal(out.text, 'open the pod bay doors.')
  assert.equal(c.held(), false)
})

test('cancelling a held thought discards it entirely', () => {
  const { c, time, set } = switchable()
  c.feed('nori')
  set(VOICE_MODE.COMMAND)
  c.feed('what is the')
  assert.equal(c.held(), true)
  assert.deepEqual(c.cancel(), { kind: 'cancelled', reason: 'held_text_discarded' })
  assert.equal(c.held(), false)
  // It must not resurface in the next conversation.
  time.advance(5000)
  assert.equal(c.settle().reason, 'nothing_held')
  // Cancelling nothing is harmless.
  assert.equal(c.cancel().reason, 'nothing_held')
})

test('guard mode treats speech as a barge-in and discards held text', () => {
  const { c, set } = switchable()
  c.feed('nori')
  set(VOICE_MODE.COMMAND)
  c.feed('tell me about')
  set(VOICE_MODE.GUARD)
  const interrupt = c.feed('wait, stop')
  assert.equal(interrupt.kind, 'command')
  assert.equal(interrupt.interrupted, true)
  assert.equal(c.held(), false)
})

test('deaf mode transcribes nothing and playback blocks everything', () => {
  assert.equal(fixed({ mode: VOICE_MODE.DEAF }).c.feed('nori').reason, 'deaf')
  // Blocked is checked before mode, so it wins even while listening.
  const speaking = switchable()
  const blocking = createWakeController({
    mode: () => VOICE_MODE.COMMAND,
    blocked: () => true,
    now: speaking.time.now,
  })
  assert.equal(blocking.feed('nori').reason, 'playback_active')
  assert.equal(blocking.settle().reason, 'nothing_held')
})

test('an unrecognised mode falls back to wake instead of trusting it', () => {
  const c = createWakeController({ mode: () => 'something-new' })
  // Treated as WAKE: only her name matters, and other speech is dropped.
  assert.equal(c.feed('what is the weather').reason, 'not_addressed_to_nori')
  assert.equal(c.feed('hey nori').kind, 'wake')
})

test('a recogniser failure is reported and clears held text', () => {
  const { c, set } = switchable()
  c.feed('nori')
  set(VOICE_MODE.COMMAND)
  c.feed('what is the')
  assert.equal(c.fail('local STT timed out').kind, 'error')
  assert.equal(c.held(), false)
  assert.equal(c.describe().lastError, 'local STT timed out')
  // The loop recovers: the next clean transcript is accepted.
  assert.equal(c.feed('turn the lights down.').kind, 'command')
})

test('the controller validates its own construction', () => {
  assert.throws(() => createWakeController({ mode: 'wake' }), NoriWakeError)
  assert.throws(() => createWakeController({ now: 5 }), NoriWakeError)
  assert.throws(() => createWakeController({ wakeDebounceMs: -1 }), NoriWakeError)
  assert.throws(() => createWakeController({ settleMs: Number.NaN }), NoriWakeError)
})

// ---------------------------------------------------------------------------
// Capability reporting
// ---------------------------------------------------------------------------

test('the descriptor is honest about what is Nori and what is imported', () => {
  const { c } = fixed()
  c.feed('hey nori')
  const described = c.describe({ sttAvailable: true, sttModel: 'base.en' })

  assert.equal(described.schema, 'nori.wake-controller.v1')
  // The state machine is Nori's and carries no trained weights.
  assert.equal(described.wake.engine, 'nori-wake-regex')
  assert.equal(described.wake.trainedWeights, false)
  assert.equal(described.wake.wakes, 1)
  // The acoustic model is imported and must stay labelled as such.
  assert.equal(described.stt.engine, 'local-whisper')
  assert.equal(described.stt.weightsOrigin, 'imported-third-party')
  assert.equal(described.stt.model, 'base.en')
  // Availability is never assumed.
  assert.equal(fixed().c.describe().stt.available, false)
  // Component evidence is never a release claim.
  assert.equal(described.releaseVerified, false)
})

test('the descriptor bounds what it reports back', () => {
  const c = createWakeController()
  c.fail('x'.repeat(5000))
  assert.ok(c.describe().lastError.length <= 200)
})
  // A comma means the transcriber cut off.
  assert.equal(looksComplete('what is the weather,'), false)
  assert.equal(looksComplete('what is the weather in London?'), true)
  assert.equal(looksComplete('open the pod bay doors.'), true)
})