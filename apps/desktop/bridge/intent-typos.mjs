/**
 * Typo-tolerant text for deterministic intent matching only. The user's
 * original words still go to the model and to tool goal cells unchanged.
 */
const INTENT_WORDS = Object.freeze(['reverse', 'engineer', 'engineering', 'analyze', 'analyse', 'inspect',
  'create', 'build', 'design', 'generate', 'application', 'weather', 'forecast', 'umbrella', 'research'])

// Real words one or two edits from an intent word; never "correct" these.
const REAL_WORDS = new Set(['built', 'guild', 'crate', 'resign', 'feather', 'leather', 'heather', 'whether',
  'engine', 'engines', 'engined', 'venerate', 'implication', 'supplication', 'reverie', 'inspector'])

function editDistance(a, b, limit) {
  if (Math.abs(a.length - b.length) > limit) return limit + 1
  let previous2 = null
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index)
  for (let i = 1; i <= a.length; i++) {
    const current = [i]
    for (let j = 1; j <= b.length; j++) {
      let cost = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
      if (previous2 && i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) cost = Math.min(cost, previous2[j - 2] + 1)
      current.push(cost)
    }
    previous2 = previous
    previous = current
  }
  return previous[b.length]
}

function correctWord(word) {
  const lower = word.toLowerCase()
  if (lower.length < 5 || REAL_WORDS.has(lower) || INTENT_WORDS.includes(lower)) return word
  for (const intent of INTENT_WORDS) {
    if (lower.startsWith(intent)) return word // inflections such as "created" or "designs"
    const limit = intent.length >= 8 ? 2 : 1
    if (editDistance(lower, intent, limit) <= limit) return intent
  }
  return word
}

export function correctIntentTypos(text) {
  return String(text ?? '').replace(/[A-Za-z]{5,14}/g, correctWord)
}
