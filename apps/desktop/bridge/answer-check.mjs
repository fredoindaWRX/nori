// 2026-11-22 (Wil: "integrate it with Nori and yourself"). The lesson of the machine-checked Riemann proof: nobody
// had to trust the model, an independent checker checked it. Same idea, small scale: after Nori answers, the app
// compares her reply with the result its own code computed before she spoke (exact-math, word-math, time-math,
// order-facts). Match: a short "checked" line. Mismatch: the computed answer, stated plainly. Nothing to check, or
// more than one possible result: silent. It never guesses and never rewrites what she said.

export const CHECKED_NOTE = '\n\n✓ Checked by code.'
export const correctionNote = expected => `\n\n(Checked by code: the computed answer is ${expected}. My reply above does not match it.)`

const strip = text => String(text ?? '')
const num = text => Number(String(text).replace(/[,$€£\s]/g, ''))

/** The one result the app computed for this turn, or null when there is none or more than one. */
export function expectedResult(appFacts) {
  const facts = strip(appFacts), found = []
  // word-math: "- answer = <expression> = <value>" (or "≈ <value>")
  for (const m of facts.matchAll(/^- answer = .*?(?:= |≈ )(-?[\d,]*\.?\d+)(?: \(exactly [^)]*\))?\s*$/gm)) found.push({ kind: 'number', value: num(m[1]), shown: m[1] })
  // exact-math: one calculation only ("- 37 * 46 - 18 * 9 = 1540")
  const exact = facts.split(/\n\n/).find(block => block.startsWith("[Exact calculations by Nori's app"))
  if (exact) {
    const lines = exact.split('\n').slice(1).filter(line => line.startsWith('- '))
    const m = lines.length === 1 && /(?:= |≈ )(-?[\d,]*\.?\d+)(?: \(exactly [^)]*\))?\s*$/.exec(lines[0])
    if (m) found.push({ kind: 'number', value: num(m[1]), shown: m[1], approx: lines[0].includes('≈') })
  }
  // time-math: the clock-hand angle
  for (const m of facts.matchAll(/the angle between them is (-?\d+(?:\.\d+)?)°/g)) found.push({ kind: 'number', value: Number(m[1]), shown: `${m[1]}°` })
  // order-facts: "So the second shortest is Cara."
  for (const m of facts.matchAll(/^- So (?:the )?(?:\w+ )?\w+ is ([A-Z][a-z]+)\./gm)) found.push({ kind: 'name', value: m[1], shown: m[1] })
  if (found.length !== 1 || (found[0].kind === 'number' && !Number.isFinite(found[0].value))) return null
  return found[0]
}

/** True when the reply states the expected result. Numbers: any number in the reply equal within rounding. */
export function replyMatches(expected, reply) {
  const text = strip(reply)
  if (expected.kind === 'name') return new RegExp(`\\b${expected.value}\\b`, 'i').test(text)
  const target = expected.value, numbers = [...text.matchAll(/-?\$?\d[\d,]*(?:\.\d+)?/g)].map(m => num(m[0])).filter(Number.isFinite)
  // Exact results must match to the cent; an approximate one (≈) allows the usual rounding of a few digits.
  const tolerance = expected.approx ? Math.max(0.005, Math.abs(target) * 0.005) : Math.max(1e-9, Math.abs(target) * 1e-9, Number.isInteger(target) ? 0 : 0.005)
  return numbers.some(n => Math.abs(n - target) <= tolerance)
}

/** The note to add after her reply: '', the checked line, or a correction. Never throws. */
export function answerCheckNote(appFacts, reply) {
  try {
    if (!strip(reply).trim()) return ''
    const expected = expectedResult(appFacts)
    if (!expected) return ''
    return replyMatches(expected, reply) ? CHECKED_NOTE : correctionNote(expected.shown)
  } catch { return '' }
}
