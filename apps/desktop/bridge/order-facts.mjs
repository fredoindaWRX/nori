// 2026-11-21 (Wil: "do it up", the hard self-test's ordering puzzles). "Ann is taller than Ben. Ben is taller than
// Cara..." The local model loses track of chains of comparisons, so the app sorts them and hands over the order.
// Only when every statement is about one measure and the order is fully determined; otherwise nothing.

export const ORDER_FACTS_HEADER = "[Worked out by Nori's app from the comparisons in the question (exact): use this order for the answer. "
  + 'If it does not match the question, ignore it.]'

// Each pair: the "more" word and its opposite. "Ann is shorter than Ben" is stored as "Ben is taller than Ann".
const PAIRS = [['taller', 'shorter'], ['older', 'younger'], ['faster', 'slower'], ['heavier', 'lighter'], ['bigger', 'smaller'],
  ['larger', 'smaller'], ['richer', 'poorer'], ['higher', 'lower'], ['longer', 'shorter'], ['stronger', 'weaker']]
const MAX_TEXT = 800

/** Comparisons in the text as {more, less, measure}, or [] when they mix measures. */
export function comparisons(text) {
  const found = []
  for (const m of String(text ?? '').matchAll(/\b([A-Z][a-z]+)\s+(?:is|was|runs|grows)\s+(?:a (?:bit|little|lot)\s+)?([a-z]+er)\s+than\s+([A-Z][a-z]+)\b/g)) {
    const [, a, word, b] = m
    const pair = PAIRS.find(([up, down]) => up === word || down === word)
    if (!pair || a === b) continue
    found.push(pair[0] === word ? { more: a, less: b, measure: pair } : { more: b, less: a, measure: pair })
  }
  // "longer/shorter" and "taller/shorter" share a word: keep the measure named by the "up" words, if any.
  const ups = new Set(found.map(c => c.measure[0]))
  if (ups.size > 1) {
    const named = [...ups].filter(up => new RegExp(`\\b${up}\\b`).test(text))
    if (named.length !== 1) return []
    for (const c of found) c.measure = PAIRS.find(([up]) => up === named[0])
  }
  return found
}

/** The unique order from most to least, or null when the comparisons leave it open or contradict. */
export function uniqueOrder(list) {
  const names = [...new Set(list.flatMap(c => [c.more, c.less]))]
  const above = new Map(names.map(n => [n, new Set()]))
  for (const c of list) above.get(c.less).add(c.more)
  const order = [], left = new Set(names)
  while (left.size) {
    const top = [...left].filter(n => [...above.get(n)].every(m => !left.has(m)))
    if (top.length !== 1) return null // a tie (not determined) or a cycle (contradiction)
    order.push(top[0]); left.delete(top[0])
  }
  return order
}

/** The app fact for an ordering puzzle, or ''. Never throws. */
export function orderFactsBlock(text) {
  try {
    const raw = String(text ?? '')
    if (!raw || raw.length > MAX_TEXT) return ''
    const list = comparisons(raw)
    if (list.length < 2) return ''
    const order = uniqueOrder(list)
    if (!order || order.length < 3) return ''
    const [up, down] = list[0].measure
    // taller -> tallest, heavier -> heaviest, bigger -> biggest: every word in PAIRS takes -est in place of -er.
    const most = up.replace(/er$/, 'est'), least = down.replace(/er$/, 'est')
    const lines = [`From ${most} to ${least}: ${order.join(', ')}.`]
    // A question for one rank ("Who is the second shortest?") gets just that answer: listing every rank made her
    // recite them all and miss "One name" (measured 2026-11-21).
    const asked = new RegExp(`\\b(?:(second|third|fourth|fifth|sixth|\\d+(?:st|nd|rd|th))\\s+)?(${most}|${least})\\b`, 'i').exec(raw)
    if (asked) {
      const n = asked[1] ? (ORD[asked[1].toLowerCase()] ?? parseInt(asked[1], 10)) : 1
      const fromTop = asked[2].toLowerCase() === most
      const name = order[fromTop ? n - 1 : order.length - n]
      if (name) lines.push(`So ${rank(n)} ${asked[2].toLowerCase()} is ${name}. Answer with that, in the format asked.`)
    } else order.forEach((name, i) => lines.push(`${name} is ${rank(i + 1)} ${most} and ${rank(order.length - i)} ${least}.`))
    return `${ORDER_FACTS_HEADER}\n${lines.map(line => `- ${line}`).join('\n')}`
  } catch { return '' }
}

const ORD = { second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6 }
const rank = n => n === 1 ? 'the' : `the ${['', '', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth'][n] ?? `${n}th`}`
