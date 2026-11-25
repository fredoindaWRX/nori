export const DEFAULT_SPEECH_EXPRESSION = Object.freeze({
  speed: 1, sentencePause: 0.2, clausePause: 0.08, pitch: 1.02,
})

const clamp = (value, min, max) => Math.max(min, Math.min(max, value))

/** Derive restrained vocal delivery from behavioral state, never factual confidence. */
export function speechExpression(snapshot) {
  if (!snapshot) return DEFAULT_SPEECH_EXPRESSION
  const { affect, appliedProfile, mode } = snapshot
  const serious = ['supportive', 'recovering', 'paused'].includes(mode)
  const energy = Math.max(affect.joy, affect.amusement * 0.8, affect.excitement * 0.75)
  const tension = Math.max(affect.concern * 0.45, affect.frustration * 0.25, affect.urgency * 0.2)
  const expressiveness = appliedProfile.enthusiasm
  const speed = serious
    ? clamp(0.98 - tension / 1000, 0.94, 0.98)
    : clamp(0.98 + (energy - 35) / 900 + (expressiveness - 40) / 2000, 0.96, 1.04)
  const sentencePause = serious
    ? clamp(0.22 + tension / 600, 0.22, 0.3)
    : clamp(0.2 + affect.uncertainty / 1800 - energy / 5000, 0.18, 0.27)
  const clausePause = clamp(0.08 + affect.uncertainty / 2500 + tension / 3000, 0.07, 0.14)
  const pitch = clamp(1.01 + (expressiveness - 40) / 3000 + energy / 8000, 0.98, 1.06)
  return Object.freeze({ speed, sentencePause, clausePause, pitch })
}

/** Strict, shared validation for renderer -> loopback bridge -> local TTS worker. */
export function validateSpeechExpression(value) {
  if (value === undefined) return DEFAULT_SPEECH_EXPRESSION
  const bounds = {
    speed: [0.94, 1.04], sentencePause: [0.18, 0.3],
    clausePause: [0.07, 0.14], pitch: [0.98, 1.06],
  }
  const keys = Object.keys(bounds)
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      keys.length !== Object.keys(value).length || keys.some(key => !Object.hasOwn(value, key))) {
    throw new Error('invalid speech expression')
  }
  for (const [key, [minimum, maximum]] of Object.entries(bounds)) {
    const number = value[key]
    if (typeof number !== 'number' || !Number.isFinite(number) || number < minimum || number > maximum) {
      throw new Error('speech expression outside supported range')
    }
  }
  return Object.freeze({ ...value })
}
