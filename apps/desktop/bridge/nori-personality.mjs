import { PERSONALITY_SCHEMA, AFFECT_TRAITS, DEFAULT_AFFECT, restorePersonality, validatePersonalityPatch, personalityInstruction } from './personality/profile.mjs'

// Conservative conversational cues, not a sentiment model or a user diagnosis.
// Serious cues win even when the same message contains "lol". No sensor access.
const SERIOUS = /\b(?:emergency|grief|grieving|funeral|died|dying|suicid\w*|hospital|panic attack|in danger|serious accident)\b/i
const SUPPORT = /\b(?:sad|upset|frustrated|angry|smh|not working|doesn['’]?t work|still broken|stop joking|no jokes|be serious)\b/i
const FRUSTRATION = /\b(?:frustrated|not working|doesn['’]?t work|still broken|smh|failed|failure)\b/i
const ANGER = /\b(?:angry|anger|irritated|irritation|pissed)\b/i
// Mad mode, added at the owner's request: rudeness aimed at her, or being told to get mad.
const MAD = /\b(?:get mad|be mad|get angry|be angry|you(?:'re| are)\s+(?:so |really |fucking |such an? |a )*(?:stupid|dumb|useless|trash|garbage|worthless|terrible|pathetic|idiot)|stupid (?:ai|bot|robot|machine|thing)|shut up|screw you|fuck you|you suck)\b/i
const ANNOYED = /\b(?:wrong again|still wrong|you keep (?:getting|messing|failing)|messed up again|get it right)\b/i
const CELEBRATE = /\b(?:we did it|it works|finally works|i won|we won|celebrate|great news)\b/i
const PLAY = /\b(?:lol|lmao|haha|funny|make me laugh|tell me a joke)\b/i
const URGENT = /\b(?:emergency|in danger|serious accident)\b/i
const UNCERTAIN = /\b(?:not sure|unsure|uncertain|maybe|don['’]?t know)\b/i
const SETTLE_MS = 90_000
const bounded = value => Math.round(Math.max(0, Math.min(100, value)))

export function createPersonality({ profile: savedProfile, clock = Date.now } = {}) {
  let profile = restorePersonality(savedProfile)
  let mode = 'ready', reason = 'Baseline personality', active = false, saved = null
  let changedAt = clock(), deltas = {}, applied = null, appliedProfile = null

  function affect() {
    if (active && applied) return { ...applied }
    const elapsed = Math.max(0, clock() - changedAt)
    const weight = Math.max(0, 1 - elapsed / SETTLE_MS)
    if (weight === 0) { mode = 'ready'; reason = 'Settled to baseline' }
    return Object.fromEntries(AFFECT_TRAITS.map(key => [key, bounded(DEFAULT_AFFECT[key] + (deltas[key] ?? 0) * weight)]))
  }
  function snapshot() {
    const values = affect()
    return { schema: PERSONALITY_SCHEMA, kind: 'context-driven-expression', profile: { ...profile },
      appliedProfile: { ...(active ? appliedProfile : profile) }, affect: values, mode, reason, active, saved }
  }
  function select(nextMode, nextReason, targets) {
    mode = nextMode; reason = nextReason; changedAt = clock()
    deltas = Object.fromEntries(AFFECT_TRAITS.map(key => [key, (targets[key] ?? DEFAULT_AFFECT[key]) - DEFAULT_AFFECT[key]]))
    applied = Object.fromEntries(AFFECT_TRAITS.map(key => [key, bounded(targets[key] ?? DEFAULT_AFFECT[key])]))
  }
  return {
    snapshot,
    profile: () => ({ ...profile }),
    setSaved: value => { saved = Boolean(value) },
    configure(patch) { profile = { ...profile, ...validatePersonalityPatch(patch) }; saved = null },
    startTurn(text, { work = false } = {}) {
      active = true
      appliedProfile = { ...profile }
      const cue = String(text).slice(0, 8000)
      if (SERIOUS.test(cue)) select('supportive', 'Serious conversational cue', { joy: 0, amusement: 0, concern: 85, excitement: 0, urgency: URGENT.test(cue) ? 90 : 0 })
      else if (MAD.test(cue)) select('ready', 'Mad: rudeness aimed at her or asked to get mad', { joy: 0, amusement: 0, frustration: 50, irritation: 75, anger: 85, concern: 5, excitement: 30, confidence: 80 })
      else if (ANNOYED.test(cue)) select('ready', 'Annoyed: told she keeps getting it wrong', { joy: 5, amusement: 0, frustration: 50, irritation: 55, anger: 45, concern: 15 })
      else if (SUPPORT.test(cue)) select('supportive', 'Support or request for seriousness', {
        joy: 5, amusement: 0, frustration: FRUSTRATION.test(cue) ? 45 : DEFAULT_AFFECT.frustration,
        irritation: ANGER.test(cue) ? 35 : FRUSTRATION.test(cue) ? 8 : DEFAULT_AFFECT.irritation,
        anger: ANGER.test(cue) ? 30 : DEFAULT_AFFECT.anger, concern: 55, excitement: 0,
      })
      else if (work) select('focused', 'Task-oriented request', { amusement: 5, curiosity: 75, urgency: 20 })
      else if (CELEBRATE.test(cue)) select('celebrating', 'Explicit good-news cue', { joy: 70, amusement: 50, excitement: 65, concern: 8 })
      else if (PLAY.test(cue)) select('playful', 'Explicit playful cue', { joy: 40, amusement: 70, excitement: 25 })
      else if (UNCERTAIN.test(cue)) select('ready', 'Conversational uncertainty cue, not a reliability score', { uncertainty: 45, confidence: 55, curiosity: 75 })
      else select('ready', 'Conversational baseline', {})
      return snapshot()
    },
    finishTurn(success) {
      active = false; applied = null; appliedProfile = null
      if (!success) select('recovering', 'Reply or task failed', { joy: 5, amusement: 0, frustration: 15, concern: 45, confidence: 45, uncertainty: 55 })
      else changedAt = clock()
      return snapshot()
    },
    interrupt() { active = false; applied = null; appliedProfile = null; select('paused', 'Reply interrupted', { joy: 10, amusement: 0, excitement: 0 }); return snapshot() },
    instruction: () => personalityInstruction(snapshot()),
  }
}
