export const VIDEO_FPS = 16
export const VIDEO_SEGMENT_FRAMES = 33
export const DEFAULT_VIDEO_DURATION_SECONDS = 8

/** Duration is a whole-frame budget, not an unbounded single model invocation. */
export function planVideoDuration(seconds) {
  if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds <= 0) {
    throw new RangeError('Video duration must be a positive, finite number of seconds.')
  }
  const totalFrames = Math.ceil(seconds * VIDEO_FPS)
  if (!Number.isSafeInteger(totalFrames) || totalFrames < 1) {
    throw new RangeError('The requested video duration is too large to represent safely; choose a shorter finite duration.')
  }
  return Object.freeze({
    totalFrames,
    durationSeconds: totalFrames / VIDEO_FPS,
    segmentCount: Math.ceil(totalFrames / VIDEO_SEGMENT_FRAMES),
  })
}

const SMALL = Object.freeze({
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7,
  eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13,
  fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19,
  twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70,
  eighty: 80, ninety: 90,
})
const NUMBER_WORD = `${Object.keys(SMALL).join('|')}|hundred|thousand|and|a|an|half|quarter|minus|negative|plus|positive`
const NUMERIC = '[+\\-−]?(?:\\d+\\/\\d+|(?:\\d+(?:\\.\\d*)?|\\.\\d+)(?:e[+\\-]?\\d+)?|infinity|nan)'
const WORD_NUMBER = `(?:${NUMBER_WORD})(?:[ -]+(?:${NUMBER_WORD})){0,12}`
const AMOUNT = `(?:${NUMERIC}|${WORD_NUMBER})`
const UNIT = '(?:seconds?|secs?|s|minutes?|mins?|m|hours?|hrs?|h)'
const MULTIPLIER = unit => /^h/i.test(unit) ? 3600 : /^m/i.test(unit) ? 60 : 1

function clockDurations(section) {
  const clock = '([+\\-−]?\\d+:\\d{2}(?::\\d{2})?)(?![\\d:])'
  const patterns = [
    new RegExp(`\\b(?:duration|length|runtime)\\s*(?:(?:of|is|to)\\s*)?[:=]?\\s*${clock}`, 'gi'),
    new RegExp(`\\b(?:create|make|generate|render|produce)\\s+(?:me\\s+)?(?:a|an)\\s+${clock}(?:[ -]+long)?[ -]+(?:video|clip)\\b`, 'gi'),
    new RegExp(`\\b(?:make|set|change)\\s+(?:it|that|the\\s+(?:video|clip))\\s+(?:(?:to|last)\\s+)?${clock}`, 'gi'),
  ]
  const matches = []
  for (const pattern of patterns) for (const match of section.matchAll(pattern)) {
    const value = match[1].replace(/−/g, '-')
    const parts = value.split(':').map(Number)
    if (/^-/.test(value) || parts.at(-1) >= 60 || (parts.length === 3 && parts[1] >= 60)) {
      throw new RangeError('Video clock duration must be positive MM:SS or HH:MM:SS with seconds and minute fields below 60.')
    }
    const seconds = parts.reduce((total, part) => total * 60 + part, 0)
    planVideoDuration(seconds)
    matches.push({ start: match.index, end: match.index + match[0].length, seconds, multiplier: 0 })
  }
  return matches
}

function wordAmount(value) {
  let normalized = value.toLowerCase().replace(/−/g, '-').trim()
  if (/^[+\-]?\d+\/\d+$/.test(normalized)) { const [numerator, denominator] = normalized.split('/').map(Number); return numerator / denominator }
  if (/^[+\-]?(?:\d|\.|infinity|nan)/i.test(normalized)) return Number(normalized)
  normalized = normalized.replace(/-/g, ' ')
  const signedWords = normalized.match(/^(minus|negative|plus|positive)\s+(.+)$/)
  if (signedWords) return wordAmount(signedWords[2]) * (/^(minus|negative)$/.test(signedWords[1]) ? -1 : 1)
  if (/^(?:a |an )?(?:half|quarter)(?: a| an)?$/.test(normalized)) return normalized.includes('half') ? 0.5 : 0.25
  const fraction = normalized.match(/^(.*?)\s+and\s+(?:a\s+)?(half|quarter)$/)
  if (fraction) return wordAmount(fraction[1]) + (fraction[2] === 'half' ? 0.5 : 0.25)
  const tokens = normalized.split(/[ -]+/).filter(token => token !== 'and')
  if (tokens.length === 1 && /^(?:a|an)$/.test(tokens[0])) return 1
  if (/^(?:a|an)$/.test(tokens[0])) tokens.shift()
  let group = 0
  let total = 0
  for (const token of tokens) {
    if (Object.hasOwn(SMALL, token)) group += SMALL[token]
    else if (token === 'hundred') group = (group || 1) * 100
    else if (token === 'thousand') { total += (group || 1) * 1000; group = 0 }
    else throw new RangeError('The requested video duration is ambiguous; specify a number of seconds, minutes, or hours.')
  }
  return total + group
}

function durationInSection(section) {
  section = section.replace(new RegExp(`(${NUMERIC}\\s*${UNIT})(?=[+\\-]?\\d)`, 'gi'), '$1 ')
  if (new RegExp(`\\d+\\s+\\d+\\/\\d+\\s*[- ]?${UNIT}(?![a-z_])`, 'i').test(section)) {
    throw new RangeError('The requested video duration is ambiguous; use a decimal or spell out the mixed fraction.')
  }
  if (/\b(?:forever|infinite(?:ly)?(?:[ -]long|[ -]length|\s+duration)?|unlimited\s+duration)\b/i.test(section)) {
    throw new RangeError('Video duration must be finite; specify seconds, minutes, or hours.')
  }
  // A range is a choice, not an exact duration. Do not quietly choose one end.
  const range = new RegExp(`(?:\\d+(?:\\.\\d*)?)\\s*(?:-|to|–|—)\\s*(?:\\d+(?:\\.\\d*)?)\\s*[- ]?${UNIT}(?![a-z_])`, 'i')
  if (range.test(section)) throw new RangeError('Conflicting video durations: choose one exact length, not a range.')
  const expression = new RegExp(`(?<![a-z_\\d.])(${AMOUNT})\\s*[- ]?(${UNIT})(?![a-z_])`, 'gi')
  const matches = clockDurations(section)
  for (const match of section.matchAll(expression)) {
    const multiplier = MULTIPLIER(match[2])
    const amount = wordAmount(match[1])
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new RangeError('Video duration must be a positive, finite number of seconds.')
    }
    let end = match.index + match[0].length
    let seconds = amount * multiplier
    const fraction = section.slice(end).match(/^\s+and\s+(?:a\s+)?(half|quarter)\b(?!\s+(?:seconds?|minutes?|hours?)\b)/i)
    if (fraction) { seconds += multiplier * (fraction[1].toLowerCase() === 'half' ? 0.5 : 0.25); end += fraction[0].length }
    matches.push({ start: match.index, end, seconds, multiplier })
  }
  if (!matches.length) return null
  matches.sort((left, right) => left.start - right.start)
  const groups = []
  let group = { ...matches[0] }
  for (const next of matches.slice(1)) {
    const between = section.slice(group.end, next.start)
    if (/^\s*(?:,?\s*and\s*)?[,\s]*$/.test(between) && next.multiplier < group.multiplier) {
      group.seconds += next.seconds
      group.end = next.end
      group.multiplier = next.multiplier
    } else {
      groups.push(group.seconds)
      group = { ...next }
    }
  }
  groups.push(group.seconds)
  if (groups.some(seconds => seconds !== groups[0])) {
    throw new RangeError('Conflicting video durations: specify one length for the finished video.')
  }
  planVideoDuration(groups[0])
  return groups[0]
}

/** Latest user refinement with a duration wins; assistant visual prose cannot set it. */
export function resolveVideoDurationSeconds(prompt = '') {
  if (typeof prompt !== 'string') throw new TypeError('Video duration parsing requires a text prompt.')
  const sections = prompt.split(/(?:^|\n)Requested refinement:\s*/i)
  for (let index = sections.length - 1; index >= 0; index--) {
    const userText = sections[index].split(/(?:^|\n)Visual reference from the preceding discussion:/i)[0]
    const seconds = durationInSection(userText)
    if (seconds !== null) return seconds
  }
  return DEFAULT_VIDEO_DURATION_SECONDS
}
