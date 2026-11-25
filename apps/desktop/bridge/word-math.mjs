// 2026-11-19 (Wil: make her a better AI). Word problems: her local model answers "15% off, then 8% tax" instantly
// and often wrongly, and its thinking mode is unusable (measured: a few garbled words, then a guess). It is good
// at writing the arithmetic down, though, so the app asks it for that alone, computes every line exactly with
// exact-math.mjs (no eval, no code run), and hands the worked lines to the answering turn as an app fact.
// Measured on the hard self-test word problems: 9 of 14 set up correctly; the rest fail to parse (she then
// answers as before) or are set up wrong (she was wrong there before too).
import { exactCalculations, exactValue } from './exact-math.mjs'
import { NORI_TEXT_ENDPOINT } from './local-endpoint.mjs'

export const WORD_MATH_HEADER = "[Worked out by Nori's app: the model wrote the arithmetic, the app computed each line exactly. "
  + 'Give the answer line as the result, in the unit asked. If a line does not match the question, ignore this and work it out yourself.]'

export const WORD_MATH_SYSTEM = "Translate the user's question into arithmetic. Reply with only lines of the form name = expression, "
  + 'using numbers, + - * / ^ ( ) and names defined on earlier lines. If a value is unknown and only described by a condition, '
  + 'write one line solve: <left side> = <right side> using a new name for the unknown (for example solve: ball + (ball + 1) = 1.1); '
  + 'later lines may use that name. The last line must be answer = ... in the unit the question '
  + 'asks for. Do not compute anything yourself. If the question needs no arithmetic, reply NONE.'

const MAX_TEXT = 800, MAX_LINES = 12
const QUESTION = /\b(?:how (?:many|much|long|far|fast|big|old)|what(?:'s| is| was| will)? (?:the )?(?:total|final|average|mean|price|cost|result|difference|speed|rate)|total|average|final price|percent|per (?:second|minute|hour|day|month|year)|calculate|work out|figure out)\b/i

/** True for a short question with at least two numbers that asks for a computed value. */
export function looksLikeWordProblem(text) {
  const value = String(text ?? '')
  if (!value || value.length > MAX_TEXT || /```/.test(value) || !QUESTION.test(value)) return false
  if ((value.match(/\d+(?:[.,]\d+)*/g) ?? []).length < 2) return false
  // Clock times ("9:20 AM to 1:05 PM") are set up wrongly (measured: -495 minutes); the model answers those itself.
  if (/\b\d{1,2}:\d{2}\b/.test(value)) return false
  // A bare sum ("what is 37*46 - 18*9") is already computed exactly by exact-math; no second model call.
  return exactCalculations(value).length === 0
}

/**
 * Parses "name = expression" lines and computes them exactly. Returns [{name, expression, value}] ending in answer, or null.
 * 2026-11-21: one linear unknown is allowed. The model writes it naturally ("bat = ball + 1.00", "bat + ball = 1.10") or
 * as "solve: left = right"; a line whose left side is not a plain name is an equation. Definitions are expanded
 * symbolically, the single equation is solved for the single unknown (solveLinear), then every line is computed.
 */
export function computeProgram(text) {
  const raw = String(text ?? '').replace(/<think>[\s\S]*?<\/think>/g, '').replace(/```\w*/g, '').trim()
  if (!raw || /^none\b/i.test(raw)) return null
  const clean = text => text.replace(/(\d),(?=\d{3}\b)/g, '$1').replace(/[$€£]/g, '').replace(/[×]/g, '*').replace(/÷/g, '/').trim()
  const symbolic = new Map(), unknowns = new Set(), defs = [], equations = []
  const expand = source => source.replace(/[a-z_][a-z0-9_]*/gi, word => {
    const key = word.toLowerCase()
    if (key === 'sqrt') return 'sqrt'
    if (symbolic.has(key)) return `(${symbolic.get(key)})`
    unknowns.add(key)
    return key
  })
  for (const line of raw.split('\n').map(item => item.trim().replace(/^[-*]\s+/, '').replace(/`/g, '')).filter(Boolean)) {
    const solve = /^solve\s*:?\s*(.+?)\s*=\s*(.+)$/i.exec(line)
    const match = solve ? null : /^([a-z_][a-z0-9_]*)\s*=\s*(.+)$/i.exec(line)
    if (match) {
      const name = match[1].toLowerCase(), source = clean(match[2])
      if (source.toLowerCase() === name) continue // "boxB = boxB" says nothing
      if (unknowns.has(name)) { equations.push({ left: name, right: expand(source), shown: line }); continue } // a fact about an unknown
      const expanded = expand(source)
      symbolic.set(name, expanded)
      defs.push({ name, expression: match[2].trim(), source: expanded })
      if (name === 'answer') break
    } else {
      const equation = solve ?? /^(.+?)\s*=\s*(.+)$/.exec(line)
      if (!equation || !/[0-9a-z]/i.test(equation[1])) continue
      equations.push({ left: expand(clean(equation[1])), right: expand(clean(equation[2])), shown: solve ? `${solve[1].trim()} = ${solve[2].trim()}` : line })
    }
    if (defs.length + equations.length > MAX_LINES) return null
  }
  if (defs.at(-1)?.name !== 'answer') return null
  const steps = []
  let solved = null
  if (unknowns.size) {
    // Exactly one unknown and one equation, linear in it; anything else is a setup the app cannot trust.
    if (unknowns.size !== 1 || equations.length !== 1) return null
    solved = solveLinear(equations[0].left, equations[0].right)
    if (!solved) return null
    steps.push({ name: solved.name, expression: equations[0].shown, value: solved.value })
  } else if (equations.length) return null
  const bind = source => solved ? source.replace(new RegExp(`\\b${solved.name}\\b`, 'g'), `(${solved.source})`) : source
  for (const def of defs) {
    let value
    try { value = exactValue(bind(def.source)) } catch { return null }
    steps.push({ name: def.name, expression: def.expression, value })
  }
  // A negative count, price, time or size means the setup was wrong; nothing these questions ask for is below zero.
  return steps.at(-1).value.replace(/^≈\s*/, '').startsWith('-') ? null : steps
}

/**
 * Solves left = right for its one undefined name, when the equation is linear in it. Exact (rational) arithmetic:
 * f(v) = left - right is evaluated as source text at v = 0, 1, 2; linear means f(2) = 2 f(1) - f(0), and the root is
 * -f(0) / (f(1) - f(0)). Returns {name, source, value} or null (no unknown, two unknowns, not linear, no single root).
 */
export function solveLinear(left, right, defined = new Map()) {
  const unknowns = new Set()
  const substitute = (side, at) => side.replace(/[a-z_][a-z0-9_]*/gi, word => {
    const key = word.toLowerCase()
    if (key === 'sqrt') return 'sqrt'
    if (defined.has(key)) return `(${defined.get(key)})`
    unknowns.add(key)
    return `(${at})`
  })
  const f = at => `((${substitute(left, at)}) - (${substitute(right, at)}))`
  const f0 = f(0), f1 = f(1), f2 = f(2)
  if (unknowns.size !== 1) return null
  try {
    if (exactValue(`${f2} - (2 * ${f1} - ${f0})`) !== '0') return null
    if (exactValue(`${f1} - ${f0}`) === '0') return null
    const source = `(-${f0}) / (${f1} - ${f0})`
    return { name: [...unknowns][0], source, value: exactValue(source) }
  } catch { return null }
}

/** The app fact for a word problem, or '' when it is not one or anything fails. Never throws. */
export async function wordMathBlock(text, { endpoint = process.env.NORI_GPT_OSS_URL || NORI_TEXT_ENDPOINT, fetcher = fetch, signal, timeoutMs = 20000 } = {}) {
  if (!looksLikeWordProblem(text)) return ''
  try {
    const timeout = AbortSignal.timeout(timeoutMs)
    const response = await fetcher(`${endpoint}/v1/chat/completions`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'nori-auto', temperature: 0, max_tokens: 300, chat_template_kwargs: { enable_thinking: false },
        messages: [{ role: 'system', content: WORD_MATH_SYSTEM }, { role: 'user', content: String(text) }] }),
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout })
    if (!response.ok) return ''
    const body = await response.json()
    const steps = computeProgram(body.choices?.[0]?.message?.content)
    if (!steps) return ''
    const shown = value => value.startsWith('≈') ? value : `= ${value}`
    return `${WORD_MATH_HEADER}\n${steps.map(step => `- ${step.name} = ${step.expression} ${shown(step.value)}`).join('\n')}`
  } catch { return '' }
}
