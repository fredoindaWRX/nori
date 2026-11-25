/**
 * Nori-owned wake and perception orchestration.
 *
 * WHAT THIS IS
 * ------------
 * The renderer already owns a working voice loop: `src/lib/voice.ts` drives a
 * VAD, POSTs each endpointed utterance to the bridge, and decides wake versus
 * command. `src/lib/wake.ts` holds the Nori-authored wake matcher. That path is
 * working and is NOT replaced by this module.
 *
 * This module is the missing piece underneath it: a headless, deterministic
 * wake state machine that can be tested without a microphone, a browser or a
 * GPU. It exists so the wake/perception behaviour is verifiable as a real
 * component rather than only through a manual conversation with the app.
 *
 * WHAT THIS IS NOT
 * ----------------
 * It is not a wake-word model and it contains no trained weights. The acoustic
 * side remains the local faster-whisper worker (`bridge/whisper_stt.py`, using
 * IMPORTED OpenAI Whisper weights). What Nori owns here is the *orchestration*:
 * when a transcript counts as a wake, what happens while a command is being
 * assembled, and how the loop recovers when the recogniser fails.
 *
 * Those two responsibilities are deliberately separated so the report can be
 * honest: the state machine below is Nori-created; the recogniser behind it is
 * not.
 */

/**
 * Mirrors the renderer's VoiceMode. Kept as local constants rather than an
 * import because this module must run in plain node without a build step.
 */
export const VOICE_MODE = Object.freeze({
  /** Powered down; only her name matters. */
  WAKE: 'wake',
  /** Expecting a command; everything spoken is a command. */
  COMMAND: 'command',
  /** Thinking or talking; anything spoken is an interruption. */
  GUARD: 'guard',
  /** Something is playing that must not be transcribed at all. */
  DEAF: 'deaf',
})

const LISTENING_MODES = Object.freeze([VOICE_MODE.WAKE, VOICE_MODE.COMMAND, VOICE_MODE.GUARD])

/**
 * Nori's wake names. Written out here rather than imported from `src/lib/wake.ts`
 * so the module is self-contained; `tests/nori-wake-controller.test.mjs` asserts
 * the two definitions agree, so they cannot drift apart silently.
 *
 * "Nori" is not high-frequency vocabulary for a general dictation model, which
 * is why the alternates exist. Chrome has routinely returned Travis, Jervis,
 * Jarvys and Java's for a perfectly clear "Nori" -- each of which used to be
 * discarded with no indication why.
 */
const NAME = '(?:nori|norrie|norry|norri)'
const WAKE = new RegExp(`\\b(?:hey|hi|ok|okay|yo)?\\s*${NAME}\\b(?!['\u2019]s\\b)`, 'i')
// The negative lookahead above is the whole possessive guard, scoped to the
// matched name exactly as the shipped renderer scopes it. It must NOT be
// widened to test the whole transcript: an apostrophe-s anywhere ("what's",
// "it's", "don't") is ordinary speech, not a mention of Nori. An earlier
// version did widen it and silently rejected "Nori, what's the weather?".

/**
 * Words that cannot end a request. Closed-class function words only: the list is
 * complete in a way a content-word list never could be, and none of them is a
 * plausible final word of a real question.
 */
const CONTINUES =
  /\b(and|or|but|so|because|since|if|when|while|that|which|who|whose|to|of|in|on|at|by|for|with|from|about|into|onto|over|under|between|through|the|a|an|my|your|his|her|its|our|their|is|are|was|were|be|been|do|does|did|have|has|had|can|could|would|should|will|shall|might|must|like|than|then|as|very|really|just|some|any|all|both|either|neither)$/i
/** Trailing punctuation a transcriber emits mid-thought. */
const TRAILS = /[,;:\u2013\u2014-]$/
/** Terminal punctuation, or a closing quote/bracket, that ends a sentence. */
const TERMINAL = /[.!?)\]}'\u201d]$/

/**
 * Resource bounds.
 *
 * These are limits on what a single recogniser segment may contain, on how much
 * text may be held while an unfinished thought is assembled, and on how long
 * that assembly may last. Without them an upstream fault (a runaway
 * transcription, a stuck worker replaying a buffer) grows unbounded memory and
 * an unbounded wait inside a component whose whole job is to stay responsive.
 *
 * The renderer has no equivalent cap, so these are NOT a claim that a
 * previously-bounded path regressed. They are a bound the headless controller
 * makes explicitly and can therefore test.
 */
const MAX_SEGMENT_CHARACTERS = 4096
const MAX_HELD_CHARACTERS = 8192
/**
 * Absolute ceiling on holding one thought. `settleMs` is idle time between
 * segments, which a stream of continuous speech never produces; without an
 * absolute deadline a thought could be held indefinitely.
 */
const MAX_HOLD_MS = 15000

/** Raised when a caller supplies input this module refuses to guess about. */
export class NoriWakeError extends Error {
  constructor(message) {
    super(message)
    this.name = 'NoriWakeError'
  }
}

/**
 * Is this transcript an address to Nori?
 *
 * Rejects possessives outright ("Nori's job" is about Nori, not to Nori) and
 * requires a word boundary so "minor" does not wake her. An explicit address
 * form ("hey Nori") still counts, because "hey Nori, what's up" is an address
 * even when the sentence also contains a possessive later on.
 *
 * @param {string} transcript
 * @returns {boolean}
 */
export function isWake(transcript) {
  if (typeof transcript !== 'string' || !transcript.trim()) return false
  // Deliberately just the renderer test, with no extra whole-transcript guard.
  //
  // WAKE already refuses a name immediately followed by a possessive, which is
  // the entire job of a possessive guard: "Nori's job" is about Nori, not to
  // Nori. An earlier version added a second check for an apostrophe-s ANYWHERE
  // in the transcript, which was wrong -- it rejected "Nori, what's the
  // weather?" because "what's" contains one. The possessive that matters is
  // the one attached to the name, and the regex lookahead already handles it.
  return WAKE.test(transcript)
}

/**
 * The text after her name in the same breath.
 *
 * "Nori, what's the weather" is one turn, not two: the user said one sentence,
 * so splitting it makes the model answer half a question and then get handed a
 * bare noun with nothing to attach it to.
 *
 * @param {string} transcript
 * @returns {string} the trailing command, or '' when only her name was said
 */
export function afterWake(transcript) {
  if (!isWake(transcript)) return ''
  const match = WAKE.exec(transcript)
  if (!match) return ''
  return transcript.slice(match.index + match[0].length).replace(/^[\s,.:;!?-]+/, '').trim()
}

/**
 * Does this text look like a finished thought?
 *
 * A trailing function word ("what's the weather in") or a comma means the
 * transcriber cut off mid-sentence. People pause to think, to look something up,
 * mid-list. An assistant that ends the turn at the first gap is one you have to
 * talk to carefully, and having to talk carefully is the whole failure.
 *
 * @param {string} text
 * @returns {boolean}
 */
export function looksComplete(text) {
  if (typeof text !== 'string') return false
  const trimmed = text.trim()
  if (!trimmed) return false
  if (TRAILS.test(trimmed)) return false
  if (CONTINUES.test(trimmed)) return false
  return TERMINAL.test(trimmed)
}

/**
 * Create the wake state machine.
 *
 * Every input is bounded and every entry point is total: there is no code path
 * that can hang or throw on bad input, because this runs inside a live voice
 * loop where an exception takes the microphone down.
 *
 * @param {object} [options]
 * @param {() => string} [options.mode]   current listening mode
 * @param {number} [options.wakeDebounceMs] one utterance yields several partials
 * @param {number} [options.settleMs]      quiet time before an incomplete thought fires
 * @param {() => number} [options.now]     clock, injectable for tests
 * @param {() => boolean} [options.blocked] true while Nori is speaking
 * @param {number} [options.maxSegmentCharacters] per-segment transcript ceiling
 * @param {number} [options.maxHeldCharacters]     aggregate held-text ceiling
 * @param {number} [options.maxHoldMs]             absolute hold deadline
 */
export function createWakeController({
  mode = () => VOICE_MODE.WAKE,
  wakeDebounceMs = 1500,
  settleMs = 700,
  now = () => Date.now(),
  blocked = () => false,
  maxSegmentCharacters = MAX_SEGMENT_CHARACTERS,
  maxHeldCharacters = MAX_HELD_CHARACTERS,
  maxHoldMs = MAX_HOLD_MS,
} = {}) {
  if (typeof mode !== 'function' || typeof now !== 'function' || typeof blocked !== 'function') {
    throw new NoriWakeError('mode, now and blocked must be functions')
  }
  if (!Number.isFinite(wakeDebounceMs) || wakeDebounceMs < 0) {
    throw new NoriWakeError('wakeDebounceMs must be a non-negative finite number')
  }
  if (!Number.isFinite(settleMs) || settleMs < 0) {
    throw new NoriWakeError('settleMs must be a non-negative finite number')
  }
  for (const [label, value] of [['maxSegmentCharacters', maxSegmentCharacters],
    ['maxHeldCharacters', maxHeldCharacters], ['maxHoldMs', maxHoldMs]]) {
    if (!Number.isFinite(value) || value <= 0) {
      throw new NoriWakeError(`${label} must be a positive finite number`)
    }
  }

  let lastWakeAt = 0
  let pendingText = ''
  let pendingSince = 0
  let wakeCount = 0
  let utteranceCount = 0
  let droppedCount = 0
  let lastError = ''
  let lastHeard = ''

  const currentMode = () => {
    const value = mode()
    return LISTENING_MODES.includes(value) || value === VOICE_MODE.DEAF ? value : VOICE_MODE.WAKE
  }

  /** Throw away a half-built thought. Never let it surface in a later turn. */
  const resetPending = () => {
    pendingText = ''
    pendingSince = 0
  }

  return {
    /**
     * Feed one transcribed segment.
     *
     * @param {string} transcript what the local recogniser heard
     * @returns {{kind: string, text?: string, trailing?: string, reason?: string}}
     *   kind is one of: wake, command, held, dropped.
     *   Never throws on bad input -- it reports a drop instead.
     */
    feed(transcript) {
      if (typeof transcript !== 'string') {
        droppedCount++
        lastError = 'transcript_not_text'
        return { kind: 'dropped', reason: 'transcript_not_text' }
      }
      const said = transcript.trim()
      if (!said) {
        droppedCount++
        return { kind: 'dropped', reason: 'nothing_intelligible' }
      }
      // Per-segment ceiling. A recogniser fault producing megabytes of text is
      // refused outright rather than buffered. Any half-built thought is
      // discarded with it: a refused segment means the utterance is no longer
      // trustworthy, and stitching a known-bad segment onto good text would
      // produce a command the user never spoke.
      if (said.length > maxSegmentCharacters) {
        droppedCount++
        lastError = 'transcript_too_long'
        resetPending()
        return { kind: 'dropped', reason: 'transcript_too_long' }
      }
      // Nori's own voice, come back through the microphone. The raised guard
      // threshold stops most of it at the door; this catches the rest.
      if (blocked()) {
        droppedCount++
        return { kind: 'dropped', reason: 'playback_active' }
      }

      lastHeard = said.slice(-80)
      lastError = ''
      const active = currentMode()

      if (active === VOICE_MODE.WAKE) {
        if (!isWake(said)) {
          droppedCount++
          return { kind: 'dropped', reason: 'not_addressed_to_nori' }
        }
        const at = now()
        if (at - lastWakeAt < wakeDebounceMs) {
          droppedCount++
          return { kind: 'dropped', reason: 'wake_debounced' }
        }
        lastWakeAt = at
        wakeCount++
        const trailing = afterWake(said)
        if (trailing) {
          // One breath: she was addressed and told something in the same turn.
          //
          // Deliberately NOT stashed as pending text. This command is being
          // returned to the caller right now, so keeping a copy would let
          // settle() emit the identical command a second time -- the same
          // request dispatched twice. Anything already dispatched must leave
          // the pending buffer empty.
          resetPending()
          utteranceCount++
          return { kind: 'command', text: trailing, trailing, wake: true }
        }
        return { kind: 'wake', trailing: '' }
      }

      if (active === VOICE_MODE.DEAF) {
        droppedCount++
        return { kind: 'dropped', reason: 'deaf' }
      }

      if (active === VOICE_MODE.GUARD) {
        // The barge-in: the user started talking over Nori. The guard threshold
        // is high, so this is a real interruption, not leaked playback.
        resetPending()
        utteranceCount++
        return { kind: 'command', text: said, trailing: '', interrupted: true }
      }

      // COMMAND: not a turn yet, a piece of one.
      const combined = pendingText ? `${pendingText} ${said}` : said
      // Aggregate ceiling across the assembled thought. Reached when a single
      // segment is legal but many together are not. Discard the whole buffer
      // rather than truncating: half a command is not a command.
      if (combined.length > maxHeldCharacters) {
        droppedCount++
        lastError = 'held_text_too_long'
        resetPending()
        return { kind: 'dropped', reason: 'held_text_too_long' }
      }
      if (looksComplete(combined)) {
        resetPending()
        utteranceCount++
        return { kind: 'command', text: combined, trailing: '' }
      }
      pendingText = combined
      // The hold deadline is measured from when this thought STARTED being
      // held, not from the most recent segment. Resetting it per segment would
      // mean continuous speech never reaches the deadline at all, because idle
      // time never elapses between words -- which is exactly the case the
      // absolute deadline exists to catch.
      if (pendingSince === 0) pendingSince = now()
      return { kind: 'held', text: combined }
    },

    /**
     * Fire a held thought once the room has been quiet long enough.
     *
     * A complete sentence fires immediately in `feed`, so an ordinary question
     * costs nothing; this only runs when there was a reason to wait.
     *
     * @returns {{kind: string, text?: string, reason?: string}}
     */
    settle() {
      if (!pendingText) return { kind: 'ignored', reason: 'nothing_held' }
      if (blocked()) return { kind: 'ignored', reason: 'playback_active' }
      const heldFor = now() - pendingSince
      // Two conditions release a held thought: the room went quiet for long
      // enough, or the thought has been held for an absolute maximum. The
      // second matters because continuous speech never produces an idle gap,
      // so idle time alone would let a thought be held forever.
      const idleRelease = heldFor >= settleMs
      const deadlineRelease = heldFor >= maxHoldMs
      if (!idleRelease && !deadlineRelease) {
        return { kind: 'ignored', reason: 'still_settling' }
      }
      const text = pendingText
      resetPending()
      utteranceCount++
      return {
        kind: 'command',
        text,
        trailing: '',
        // Which deadline released it, and how long the thought was held.
        //
        // `release` is the honest signal: 'idle' means the room went quiet,
        // 'hold_deadline' means the absolute ceiling expired. There is
        // deliberately no separate "forced" boolean -- when a thought is
        // held past BOTH thresholds it is ambiguous which one fired, and a
        // flag that guessed would be worse than one that reports the facts.
        heldForMs: heldFor,
        release: deadlineRelease ? 'hold_deadline' : 'idle',
      }
    },

    /** Drop a held thought. Used when the mode changed underneath us. */
    cancel() {
      const had = Boolean(pendingText)
      resetPending()
      return { kind: 'cancelled', reason: had ? 'held_text_discarded' : 'nothing_held' }
    },

    /** A recogniser failure. Distinct from the user saying nothing. */
    fail(message) {
      lastError = String(message ?? 'recogniser_failure').slice(0, 200)
      resetPending()
      return { kind: 'error', reason: lastError }
    },

    /** True while a thought is waiting for the room to go quiet. */
    held() {
      return Boolean(pendingText)
    },

    /**
     * Capability and health descriptor.
     *
     * This is the interface proposed to the Core lane in
     * verification/CLINE_HANDOFF_2026-10-01.txt section 4.1. It reports only
     * what this module can prove about itself; the recogniser's own readiness is
     * passed in by the caller rather than guessed here.
     *
     * @param {{sttAvailable?: boolean, sttEngine?: string, sttModel?: string}} [state]
     */
    describe(state = {}) {
      return {
        schema: 'nori.wake-controller.v1',
        wake: {
          armed: true,
          // Nori-authored matching over local recognition output. Not a
          // trained wake-word model and not presented as one.
          engine: 'nori-wake-regex',
          trainedWeights: false,
          debounceMs: wakeDebounceMs,
          settleMs,
          maxHoldMs,
          maxSegmentCharacters,
          maxHeldCharacters,
          wakes: wakeCount,
          since_ms: lastWakeAt || null,
        },
        stt: {
          available: state.sttAvailable === true,
          // Explicitly attributed: the acoustic model is IMPORTED Whisper.
          engine: state.sttEngine ?? 'local-whisper',
          weightsOrigin: 'imported-third-party',
          model: state.sttModel ?? null,
        },
        utteranceCount,
        dropped: droppedCount,
        held: Boolean(pendingText),
        lastHeard: lastHeard.slice(-80),
        lastError,
        releaseVerified: false,
      }
    },
  }
}

export { WAKE as WAKE_PATTERN, VOICE_MODE as MODES }