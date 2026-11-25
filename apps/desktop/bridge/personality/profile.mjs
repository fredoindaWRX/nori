/** Shared packaged tone contract. Values describe expression, not subjective feelings. */
export const PERSONALITY_SCHEMA = 'nori.personality.v2'
export const PERSONALITY_TRAITS = Object.freeze([
  'humor', 'honesty', 'warmth', 'enthusiasm', 'sarcasm', 'curiosity',
  'directness', 'patience', 'discretion', 'playfulness', 'empathy', 'formality',
])
export const DEFAULT_PERSONALITY = Object.freeze({
  humor: 70, honesty: 95, warmth: 60, enthusiasm: 40, sarcasm: 55, curiosity: 85,
  directness: 85, patience: 75, discretion: 90, playfulness: 55, empathy: 70, formality: 25,
})
export const AFFECT_TRAITS = Object.freeze([
  'joy', 'amusement', 'frustration', 'irritation', 'anger', 'concern',
  'excitement', 'confidence', 'uncertainty', 'curiosity', 'urgency',
])
export const DEFAULT_AFFECT = Object.freeze({
  joy: 20, amusement: 35, frustration: 5, irritation: 3, anger: 0, concern: 8,
  excitement: 12, confidence: 75, uncertainty: 10, curiosity: 60, urgency: 0,
})

export function validatePersonalityPatch(patch) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new Error('Personality must be an object.')
  const keys = Object.keys(patch)
  if (!keys.length || keys.length > PERSONALITY_TRAITS.length) throw new Error('Choose at least one personality trait.')
  const result = {}
  for (const key of keys) {
    if (!PERSONALITY_TRAITS.includes(key)) throw new Error('Unknown personality trait.')
    if (!Number.isInteger(patch[key]) || patch[key] < 0 || patch[key] > 100) throw new Error('Personality values must be whole numbers from 0 to 100.')
    result[key] = patch[key]
  }
  return result
}

export function restorePersonality(saved) {
  try {
    // Migrate only the old four-slider contract. Its "joy" preference was
    // upbeat delivery, so it becomes enthusiasm, NOT persistent affect.
    if (saved && Object.hasOwn(saved, 'joy') && Object.keys(saved).every(key => ['humor', 'joy', 'warmth', 'curiosity'].includes(key))) {
      const { joy, ...rest } = saved
      return { ...DEFAULT_PERSONALITY, ...validatePersonalityPatch({ ...rest, enthusiasm: joy }) }
    }
    return { ...DEFAULT_PERSONALITY, ...validatePersonalityPatch(saved) }
  }
  catch { return { ...DEFAULT_PERSONALITY } }
}

function fullValues(values, keys) {
  return values && typeof values === 'object' && !Array.isArray(values)
    && Object.keys(values).length === keys.length
    && keys.every(key => Object.hasOwn(values, key) && Number.isInteger(values[key]) && values[key] >= 0 && values[key] <= 100)
}

export function validPersonalitySnapshot(value) {
  if (!value || value.schema !== PERSONALITY_SCHEMA || value.kind !== 'context-driven-expression') return false
  const modes = ['ready', 'playful', 'celebrating', 'focused', 'supportive', 'recovering', 'paused']
  if (!modes.includes(value.mode) || typeof value.active !== 'boolean') return false
  if (typeof value.reason !== 'string' || value.reason.length > 120) return false
  if (value.saved !== null && typeof value.saved !== 'boolean') return false
  try {
    return Boolean(fullValues(value.profile, PERSONALITY_TRAITS)
      && fullValues(value.appliedProfile, PERSONALITY_TRAITS) && fullValues(value.affect, AFFECT_TRAITS))
  } catch { return false }
}

/** Fixed text only: arbitrary profile/config input never becomes policy. */
export function personalityInstruction(snapshot) {
  if (!validPersonalitySnapshot(snapshot)) return ''
  const p = snapshot.appliedProfile, a = snapshot.affect
  const serious = ['supportive', 'recovering', 'paused'].includes(snapshot.mode)
  const humor = serious || p.humor === 0 ? 'off' : snapshot.mode === 'focused' || p.humor < 40 ? 'rare' : p.humor < 75 ? 'dry' : 'welcome-only'
  const joy = serious || p.enthusiasm < 25 ? 'steady' : a.joy >= 60 && p.enthusiasm >= 60 ? 'upbeat' : 'measured'
  const warmth = p.warmth < 35 ? 'neutral' : p.warmth < 75 ? 'friendly' : 'warm'
  const curiosity = p.curiosity < 35 ? 'on-topic' : 'relevant'
  const honesty = p.honesty >= 75 ? 'evidence-first' : 'truthful'
  const sarcasm = serious || snapshot.mode === 'focused' || p.sarcasm < 35 ? 'off' : 'gentle-only; no targets'
  const directness = p.directness >= 70 ? 'answer-first' : 'context'
  const patience = p.patience >= 60 ? 'patient' : 'brisk, respectful'
  const discretion = p.discretion >= 60 ? 'private' : 'permission-required'
  const playfulness = serious || p.playfulness < 35 ? 'off' : 'optional'
  const empathy = p.empathy >= 60 ? 'acknowledge' : 'respectful'
  const formality = p.formality < 35 ? 'casual' : p.formality < 75 ? 'professional' : 'formal'
  const affectGuidance = [
    ['joy', `joy=${serious || a.joy < 60 ? 'steady' : 'bright'}`],
    ['amusement', `amusement=${serious || a.amusement < 60 ? 'off' : 'welcome-wit'}`],
    ['frustration', `frustration=${a.frustration >= 35 ? 'patient/no-blame' : 'neutral'}`],
    ['irritation', `irritation=${a.irritation >= 25 ? 'calm' : 'respectful'}`],
    ['anger', `anger=${a.anger >= 60 ? 'openly annoyed: blunt and short, no insults or threats, still help' : a.anger >= 25 ? 'calm/no-mirroring' : 'respectful'}`],
    ['concern', `concern=${a.concern >= 40 ? 'acknowledge' : 'observe'}`],
    ['excitement', `excitement=${a.excitement >= 60 && !serious ? 'modest' : 'measured'}`],
    ['confidence', `confidence=${a.confidence >= 70 ? 'evidence-bound' : 'measured'}`],
    ['uncertainty', `uncertainty=${a.uncertainty >= 40 ? 'cautious/unknowns' : 'direct/limits'}`],
    ['curiosity', `curiosity=${a.curiosity >= 75 ? 'one-angle' : 'on-topic'}`],
    ['urgency', `urgency=${a.urgency >= 70 ? 'urgent-calm' : 'normal'}`],
  ].filter(([trait]) => serious || a[trait] !== DEFAULT_AFFECT[trait]).map(([, guidance]) => guidance)
  // Default affect already means ordinary delivery; send only deviations to
  // conserve Nori's small native prompt window for the user's request.
  return `Nori [humor:${humor}; enthusiasm:${joy}; warmth:${warmth}; curiosity:${curiosity}; honesty:${honesty}; sarcasm:${sarcasm}; directness:${directness}; patience:${patience}; discretion:${discretion}; play:${playfulness}; empathy:${empathy}; formality:${formality}]. Affect [${affectGuidance}]. Style, not feelings/reliability; never alter facts, permissions, privacy or decisions.`
}
