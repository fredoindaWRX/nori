// Exact arithmetic for numbers written in the owner's message. Small local models answer
// "999 * 999" instantly and sometimes wrongly; the app computes such expressions itself and
// hands the results to the model as facts. A tiny parser over exact fractions (BigInt): no
// eval, no code execution, bounded input. Word problems still go to the model.
export const EXACT_MATH_HEADER = "[Exact calculations by Nori's app: computed, not guessed. Use these values when the request asks for them.]"

const MAX_INPUT = 2000, MAX_EXPRESSIONS = 6, MAX_DIGITS = 400
// Only messages that ask for a value; "takes 10-15 minutes" alone is not a calculation.
const CUE = /\b(?:what(?:'s|s| is| are)|how much(?: is)?|calculate|compute|evaluate|work out|solve|equals?|square root|sqrt|tip on|percent of|% of)\b|=|^\s*[\d(.]/i

const gcd = (a, b) => { a = a < 0n ? -a : a; b = b < 0n ? -b : b; while (b) [a, b] = [b, a % b]; return a }
function frac(n, d = 1n) {
  if (d === 0n) throw RangeError('division by zero')
  if (d < 0n) { n = -n; d = -d }
  const g = gcd(n, d) || 1n
  return { n: n / g, d: d / g }
}
const add = (a, b) => frac(a.n * b.d + b.n * a.d, a.d * b.d)
const sub = (a, b) => frac(a.n * b.d - b.n * a.d, a.d * b.d)
const mul = (a, b) => frac(a.n * b.n, a.d * b.d)
const div = (a, b) => frac(a.n * b.d, a.d * b.n)
const size = a => String(a.n).length + String(a.d).length
function pow(a, b) {
  if (b.d !== 1n || b.n > 4096n || b.n < -4096n) throw RangeError('unsupported power')
  const e = b.n < 0n ? -b.n : b.n
  if (String(a.n).length * Number(e) > MAX_DIGITS * 2) throw RangeError('result too large')
  const r = frac(a.n ** e, a.d ** e)
  return b.n < 0n ? div(frac(1n), r) : r
}
function parseNumber(text) {
  const [whole, part = ''] = text.split('.')
  return frac(BigInt(`${whole || '0'}${part}`), 10n ** BigInt(part.length))
}
function sqrt(a) {
  if (a.n < 0n) throw RangeError('negative square root')
  const root = x => { if (x < 2n) return x; let r = BigInt(Math.floor(Math.sqrt(Number(x)))); while (r * r > x) r--; while ((r + 1n) * (r + 1n) <= x) r++; return r }
  const n = root(a.n), d = root(a.d)
  if (n * n === a.n && d * d === a.d) return { value: frac(n, d), exact: true }
  return { value: null, approx: Math.sqrt(Number(a.n) / Number(a.d)), exact: false }
}

// Recursive descent: expr = term (+|- term)*; term = power (*|/ power)*; power = unary (^ power)?
function evaluate(source) {
  const tokens = source.match(/\d+(?:\.\d+)?|\.\d+|sqrt|[-+*/^()]/g)
  if (!tokens || tokens.join('') !== source.replace(/\s+/g, '')) throw SyntaxError('unrecognized input')
  let i = 0, approx = false
  const peek = () => tokens[i], take = () => tokens[i++]
  const expr = () => { let v = term(); while (peek() === '+' || peek() === '-') v = take() === '+' ? add(v, term()) : sub(v, term()); return v }
  const term = () => { let v = power(); while (peek() === '*' || peek() === '/') v = take() === '*' ? mul(v, power()) : div(v, power()); return v }
  const power = () => { const base = unary(); if (peek() === '^') { take(); return pow(base, power()) } return base }
  const unary = () => {
    if (peek() === '-') { take(); return mul(frac(-1n), unary()) }
    if (peek() === '+') { take(); return unary() }
    return atom()
  }
  const atom = () => {
    const t = take()
    if (t === '(') { const v = expr(); if (take() !== ')') throw SyntaxError('missing )'); return v }
    if (t === 'sqrt') {
      if (take() !== '(') throw SyntaxError('sqrt needs (')
      const inner = expr(); if (take() !== ')') throw SyntaxError('missing )')
      const r = sqrt(inner)
      if (r.exact) return r.value
      approx = true
      const scaled = BigInt(Math.round(r.approx * 1e12))
      return frac(scaled, 10n ** 12n)
    }
    if (t !== undefined && /^[\d.]/.test(t)) return parseNumber(t)
    throw SyntaxError('unexpected token')
  }
  const value = expr()
  if (i !== tokens.length) throw SyntaxError('trailing input')
  if (size(value) > MAX_DIGITS) throw RangeError('result too large')
  return { value, approx }
}

function format({ value, approx }) {
  const { n, d } = value
  if (d === 1n && !approx) return n.toString()
  // Terminating decimal when the denominator has only 2s and 5s; otherwise 12 significant digits.
  let rest = d; while (rest % 2n === 0n) rest /= 2n; while (rest % 5n === 0n) rest /= 5n
  if (rest === 1n && !approx) {
    let places = 0n, scale = 1n; while (scale % d !== 0n) { scale *= 10n; places++ }
    const scaled = n * (scale / d), negative = scaled < 0n, digits = (negative ? -scaled : scaled).toString().padStart(Number(places) + 1, '0')
    return `${negative ? '-' : ''}${digits.slice(0, -Number(places))}.${digits.slice(-Number(places))}`
  }
  const text = Number((Number(n) / Number(d)).toPrecision(12)).toString()
  return `≈ ${text}${!approx && d < 1000n ? ` (exactly ${n}/${d})` : ''}`
}

// Rewrites spoken arithmetic into symbols, then finds candidate expressions.
function normalize(text) {
  return ` ${text} `.toLowerCase()
    .replace(/\b\d{4}-\d{1,2}-\d{1,2}\b|\b\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\b|\b\d{1,2}:\d{2}\b/g, ' ; ') // dates and times
    .replace(/(\d),(?=\d{3}\b)/g, '$1')
    .replace(/[$€£]/g, '')
    .replace(/(\d)\s*[×x]\s*(?=[\d(])/g, '$1*').replace(/÷/g, '/').replace(/[−–]/g, '-').replace(/\*\*/g, '^')
    .replace(/\bsquare root of\s+(\d+(?:\.\d+)?)/g, 'sqrt($1)').replace(/√\s*(\d+(?:\.\d+)?)/g, 'sqrt($1)')
    .replace(/(\d+(?:\.\d+)?)\s*(?:%|percent)\s+(?:tip\s+)?(?:of|on)\s+(\d+(?:\.\d+)?)/g, '($1/100*$2)')
    .replace(/(\d+(?:\.\d+)?)\s+(?:and\s+)?(?:is|are|with)\s+(\d+(?:\.\d+)?)\s*(?:%|percent)\s+off\b/g, '($1-$2/100*$1)')
    .replace(/(\d+(?:\.\d+)?)\s*(?:%|percent)\s+off\s+(\d+(?:\.\d+)?)/g, '($2-$1/100*$2)')
    .replace(/\b(?:multiplied by|times)\b/g, '*').replace(/\bdivided by\b/g, '/').replace(/\bplus\b/g, '+').replace(/\bminus\b/g, '-')
    .replace(/\b(?:to the power of|raised to(?: the power of)?)\b/g, '^')
    .replace(/(\d|\))\s+squared\b/g, '$1^2').replace(/(\d|\))\s+cubed\b/g, '$1^3')
}

export function exactCalculations(text) {
  const input = String(text ?? '')
  if (!input || input.length > MAX_INPUT || !CUE.test(input)) return []
  const results = [], seen = new Set()
  const normalized = normalize(input)
  for (const match of normalized.matchAll(/(?:sqrt\(|[\d(.-])[\d\s.+\-*/^()sqrt]*[\d)]/g)) {
    // Part of a word or name ("qwen3.6-35b", "mp3", "covid-19") is not arithmetic.
    const before = normalized[match.index - 1] ?? ' ', after = normalized[match.index + match[0].length] ?? ' '
    if (/[a-z_]/.test(before) || /[a-z_\d]/.test(after)) continue
    const raw = match[0]
    const expression = raw.trim().replace(/\s+/g, ' ')
    // At least one operator between two operands, so a lone number or "-5" is not a calculation.
    if (!/[\d)]\s*[-+*/^]\s*[-+(\d.s]/.test(expression) && !/^sqrt\(/.test(expression)) continue
    if (seen.has(expression)) continue
    seen.add(expression)
    try { const shown = format(evaluate(expression)); results.push(`${expression} ${shown.startsWith('≈') ? shown : `= ${shown}`}`) } catch {}
    if (results.length >= MAX_EXPRESSIONS) break
  }
  return results
}

// One expression in the parser's own syntax, computed exactly and formatted like the lines above. Throws on
// anything it does not accept. Used by word-math.mjs for arithmetic the model wrote out.
export function exactValue(expression) {
  const source = String(expression ?? '')
  if (source.length > MAX_INPUT) throw RangeError('expression too long')
  return format(evaluate(source))
}

export function exactMathBlock(text) {
  const lines = exactCalculations(text)
  return lines.length ? `${EXACT_MATH_HEADER}\n${lines.map(line => `- ${line}`).join('\n')}` : ''
}
