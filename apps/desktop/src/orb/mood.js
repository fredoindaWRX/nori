// Nori's mood colour, from the affect values her bridge already publishes (0-100, per trait).
// These are conversation and task cues, not measured emotions; the colour reflects those cues.
export const DEFAULT_AFFECT = Object.freeze({
  joy: 20, amusement: 35, frustration: 5, irritation: 3, anger: 0, concern: 8,
  excitement: 12, confidence: 75, uncertainty: 10, curiosity: 60, urgency: 0,
})
const CALM = [255, 170, 48]
const COLOURS = {
  joy: [255, 205, 60], amusement: [255, 120, 200], excitement: [255, 95, 40], anger: [255, 25, 20],
  irritation: [255, 70, 30], frustration: [225, 55, 45], concern: [70, 140, 255], curiosity: [50, 225, 205],
  uncertainty: [150, 120, 255], urgency: [255, 40, 100], confidence: [255, 170, 48],
}
const NAMES = {
  joy: 'happy', amusement: 'amused', excitement: 'excited', anger: 'angry', irritation: 'irritated',
  frustration: 'frustrated', concern: 'concerned', curiosity: 'curious', uncertainty: 'unsure',
  urgency: 'urgent', confidence: 'confident',
}

export function moodOf(affect) {
  let total = 1, top = null, topAmount = 0
  const sum = [...CALM]
  if (affect && typeof affect === 'object') {
    for (const [trait, colour] of Object.entries(COLOURS)) {
      const value = Number(affect[trait])
      if (!Number.isFinite(value)) continue
      const rest = DEFAULT_AFFECT[trait]
      const excess = Math.max(0, value - rest) / (100 - rest)
      if (excess <= 0) continue
      const weight = excess * 4
      total += weight
      for (let i = 0; i < 3; i++) sum[i] += colour[i] * weight
      if (excess > topAmount) { topAmount = excess; top = trait }
    }
  }
  const anger = Number(affect?.anger)
  const rage = Number.isFinite(anger) ? Math.max(0, Math.min(1, (anger - 25) / 60)) : 0
  return { rgb: sum.map(part => Math.round(part / total)), name: top && topAmount >= 0.06 ? NAMES[top] : 'calm', rage }
}
