/**
 * The narrow set of display commands N.O.R.I. can apply without involving a
 * model or the durable work runtime.  Keeping recognition and application in
 * one module prevents the chat router and the UI adapter from disagreeing.
 */
export const NORI_COLOURS = Object.freeze({
  red: '#ff3344', crimson: '#dc143c', blue: '#28a8ff', cyan: '#17b3b3',
  green: '#3ee38a', amber: '#ffb020', orange: '#ff7a18', violet: '#a56bff',
  purple: '#a56bff', white: '#eafcff', gold: '#ffd166',
})

const COSMETIC_TARGET = '\\b(?:hud|interface|display|screen|theme|accent|colour|color|orb|entity|systems?|rails?)\\b'
const COSMETIC_ACTION = '\\b(?:set|change|turn|show|hide|reset|restore|clear)\\b'
const cosmetic = new RegExp(`${COSMETIC_ACTION}[^.]{0,80}${COSMETIC_TARGET}`, 'i')

export function isCosmeticNoriCommand(goal) {
  return cosmetic.test(goal)
}

export function applyNoriUiCommand(goal, emit) {
  if (typeof emit !== 'function') return false
  let applied = false
  const lower = goal.toLowerCase()
  if (/\b(reset|restore)\b.*\b(interface|hud|screen|theme)\b/.test(lower)) { emit('reset', {}); applied = true }
  if (/\b(clear)\b.*\b(screen|display|hud|panels)\b/.test(lower)) { emit('screen', { what: 'all' }); applied = true }
  const colour = Object.keys(NORI_COLOURS).find((name) =>
    new RegExp(`\\b(?:make|turn|set|theme|colour|color|tint)\\b[^.]{0,50}\\b${name}\\b`).test(lower))
  if (colour) { emit('patch', { accent: NORI_COLOURS[colour] }); applied = true }
  if (/\bhide\b.*\b(systems|system list|rails?)\b/.test(lower)) { emit('patch', { chrome: { systems: false } }); applied = true }
  if (/\bshow\b.*\b(systems|system list|rails?)\b/.test(lower)) { emit('patch', { chrome: { systems: true } }); applied = true }
  const effect = ['glitch', 'pulse', 'scan', 'shake', 'flash'].find((name) => new RegExp(`\\b${name}\\b`).test(lower))
  if (effect && /\b(effect|screen|interface|hud|do|fire|trigger)\b/.test(lower)) { emit('effect', { kind: effect }); applied = true }
  return applied
}
