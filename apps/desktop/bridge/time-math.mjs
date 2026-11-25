// 2026-11-19 (Wil: fix clock times and weekdays). Her local model gets clock arithmetic, time zones and weekday
// counting wrong (hard self-test: reasoning 6/15), and the word-math setup writes clock times as negative minutes.
// These are computed here by code from the question's own words, and the results go to the answering turn as an
// app fact before "[User request]". Each rule only fires on an unambiguous pattern; anything else returns ''.

export const TIME_MATH_HEADER = "[Worked out by Nori's app with the clock and calendar (exact): use these results for the answer, "
  + 'in the format the user asked for. If a line does not match the question, ignore it.]'

const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']
const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december']
const ORDINALS = { first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7, eighth: 8, ninth: 9, tenth: 10, eleventh: 11, twelfth: 12 }
const ZONES = { utc: 0, gmt: 0, z: 0, est: -5, edt: -4, cst: -6, cdt: -5, mst: -7, mdt: -6, pst: -8, pdt: -7, bst: 1, cet: 1, cest: 2,
  eet: 2, eest: 3, ist: 5.5, jst: 9, kst: 9, aest: 10, aedt: 11, nzst: 12, nzdt: 13,
  'eastern standard time': -5, 'eastern daylight time': -4, 'central standard time': -6, 'central daylight time': -5,
  'mountain standard time': -7, 'mountain daylight time': -6, 'pacific standard time': -8, 'pacific daylight time': -7,
  'greenwich mean time': 0, 'coordinated universal time': 0, 'central european time': 1, 'japan standard time': 9 }

const MAX_TEXT = 600
const pad = n => String(n).padStart(2, '0')
const mod = (a, n) => ((a % n) + n) % n
const gcd = (a, b) => (b ? gcd(b, a % b) : a)

/** Clock times in order: {minutes, hasMeridiem, at}. Accepts 10:40 AM, 10 AM, 22:15, 02:10. */
export function clockTimes(text) {
  const found = []
  const re = /\b(\d{1,2})(?::(\d{2}))?\s*([ap])\.?\s?m\b\.?|\b(\d{1,2}):(\d{2})\b/gi
  for (const m of String(text).matchAll(re)) {
    if (m[1] !== undefined) {
      const h = Number(m[1]), min = Number(m[2] ?? 0)
      if (h < 1 || h > 12 || min > 59) continue
      found.push({ minutes: (h % 12 + (m[3].toLowerCase() === 'p' ? 12 : 0)) * 60 + min, hasMeridiem: true, at: m.index })
    } else {
      const h = Number(m[4]), min = Number(m[5])
      if (h > 23 || min > 59) continue
      found.push({ minutes: h * 60 + min, hasMeridiem: false, twentyFour: h >= 13 || /^0\d/.test(m[4]), at: m.index })
    }
  }
  return found
}

function showClock(minutes, style) {
  const m = mod(Math.round(minutes), 1440), h = Math.floor(m / 60), min = m % 60
  const twelve = `${h % 12 || 12}:${pad(min)} ${h < 12 ? 'AM' : 'PM'}`
  return style === '12' ? twelve : `${pad(h)}:${pad(min)} (${twelve})`
}
const showSpan = minutes => `${minutes} minutes (${Math.floor(minutes / 60)} h ${minutes % 60} min)`

/** Durations in order, in minutes ("95 minutes", "2 hours 45 minutes", "1.5 h", "20-minute break"). */
export function durations(text) {
  const out = []
  for (const m of String(text).matchAll(/\b(\d+(?:\.\d+)?)[\s-]*(hours?|hrs?|h|minutes?|mins?)\b/gi)) {
    const n = Number(m[1]), hours = /^h/i.test(m[2])
    out.push({ minutes: hours ? n * 60 : n, at: m.index })
  }
  return out
}

function zoneMentions(text) {
  const names = Object.keys(ZONES).filter(k => k.length > 1).sort((a, b) => b.length - a.length).map(k => k.replace(/ /g, '\\s+'))
  const re = new RegExp(`\\b(?:(?:utc|gmt)\\s*([+\\-−])\\s*(\\d{1,2})(?::?(\\d{2}))?|(${names.join('|')}))\\b`, 'gi')
  const out = []
  for (const m of String(text).matchAll(re)) {
    if (m[1]) out.push({ offset: (m[1] === '+' ? 1 : -1) * (Number(m[2]) + Number(m[3] ?? 0) / 60), at: m.index })
    else out.push({ offset: ZONES[m[4].toLowerCase().replace(/\s+/g, ' ')], at: m.index })
  }
  return out
}

function parseDates(text, fallbackYear) {
  const out = []
  const monthRe = MONTHS.map(n => `${n}|${n.slice(0, 3)}`).join('|')
  const patterns = [
    [/\b(\d{4})-(\d{1,2})-(\d{1,2})\b/g, m => [Number(m[1]), Number(m[2]), Number(m[3])]],
    [new RegExp(`\\b(${monthRe})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(\\d{4}))?\\b`, 'gi'), m => [Number(m[3] ?? fallbackYear), monthIndex(m[1]) + 1, Number(m[2])]],
    [new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?(${monthRe})\\.?(?:,?\\s+(\\d{4}))?\\b`, 'gi'), m => [Number(m[3] ?? fallbackYear), monthIndex(m[2]) + 1, Number(m[1])]],
    [/\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/g, m => [Number(m[3]), Number(m[1]), Number(m[2])]],
  ]
  for (const [re, pick] of patterns) for (const m of String(text).matchAll(re)) {
    const [y, mo, d] = pick(m)
    if (!(mo >= 1 && mo <= 12 && d >= 1 && d <= 31)) continue
    const day = Date.UTC(y, mo - 1, d)
    if (new Date(day).getUTCDate() !== d) continue
    if (!out.some(item => item.at <= m.index && m.index < item.end)) out.push({ day: day / 86400000, at: m.index, end: m.index + m[0].length, y, mo, d })
  }
  return out.sort((a, b) => a.at - b.at)
}
const monthIndex = name => MONTHS.findIndex(n => n.startsWith(name.toLowerCase().slice(0, 3)))
const showDate = day => { const d = new Date(day * 86400000); return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}` }
const cap = s => s[0].toUpperCase() + s.slice(1)

function weekdayLines(text, now) {
  const lines = [], lower = text.toLowerCase()
  const todayMatch = /\btoday is (?:a )?(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/i.exec(text)
  const offsets = [...lower.matchAll(/\b(?:in (\d+) (days?|weeks?)|(\d+) (days?|weeks?) (from now|from today|later|after|ago|before|earlier|from (?:then|that day)))/g)]
    .map(m => { const n = Number(m[1] ?? m[3]), unit = (m[2] ?? m[4]).startsWith('week') ? 7 : 1, back = /ago|before|earlier/.test(m[5] ?? ''); return (back ? -1 : 1) * n * unit })
  const dates = parseDates(text, now.getFullYear())
  if (offsets.length === 1 && dates.length === 0) {
    const n = offsets[0]
    if (todayMatch) {
      const start = WEEKDAYS.indexOf(todayMatch[1].toLowerCase())
      lines.push(`${n} days from a ${cap(WEEKDAYS[start])} is a ${cap(WEEKDAYS[mod(start + n, 7)])} (${Math.abs(n)} mod 7 = ${mod(Math.abs(n), 7)}).`)
    } else if (/\b(?:now|today)\b/.test(lower)) {
      const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()) / 86400000
      lines.push(`Today is ${cap(WEEKDAYS[mod(today + 4, 7)])} ${showDate(today)}; ${n} days from today is ${cap(WEEKDAYS[mod(today + n + 4, 7)])} ${showDate(today + n)}.`)
    }
  }
  if (dates.length >= 2 && /\b(?:week)?days?\b/i.test(lower)) {
    // "2026-11-17 is a Tuesday. What weekday is 2026-12-25?" keeps the stated weekday; otherwise the real calendar.
    const stated = new RegExp(`^[\\s,]*(?:is|was|will be|falls on)\\s+(?:a\\s+)?(${WEEKDAYS.join('|')})\\b`, 'i').exec(text.slice(dates[0].end))
    const [a, b] = dates, between = b.day - a.day
    const realA = mod(a.day + 4, 7), refA = stated ? WEEKDAYS.indexOf(stated[1].toLowerCase()) : realA
    const [early, late] = between >= 0 ? [a, b] : [b, a]
    lines.push(`From ${showDate(early.day)} to ${showDate(late.day)} is ${Math.abs(between)} days.`)
    if (/\bweekday|day of the week|what day\b/i.test(lower)) lines.push(`${showDate(b.day)} is a ${cap(WEEKDAYS[mod(refA + between, 7)])}.`)
  } else if (dates.length === 1 && /\b(?:weekday|day of the week|what day)\b/i.test(lower) && offsets.length === 0) {
    lines.push(`${showDate(dates[0].day)} is a ${cap(WEEKDAYS[mod(dates[0].day + 4, 7)])}.`)
  }
  return lines
}

function clockLines(text) {
  const lines = [], lower = text.toLowerCase(), times = clockTimes(text)
  if (/\bclock (?:shows|reads)|\bangle\b|\bhands?\b/.test(lower)) {
    // Clock-hand angle (2026-11-21): hour hand 30° per hour + 0.5° per minute, minute hand 6° per minute.
    if (times.length === 1 && /\bangle\b/.test(lower) && /\bhands?\b/.test(lower)) {
      const h = Math.floor(times[0].minutes / 60) % 12, m = times[0].minutes % 60
      const raw = Math.abs(30 * h - 5.5 * m), angle = Math.min(raw, 360 - raw)
      lines.push(`At ${h || 12}:${pad(m)} the hour hand is at ${30 * h + 0.5 * m}° and the minute hand at ${6 * m}°, so the angle between them is ${angle}° (the other way round ${360 - angle}°).`)
    }
    return lines
  }
  const zones = zoneMentions(text)
  if (times.length === 1 && zones.length >= 2 && /\b(?:convert|in|to|what time)\b/.test(lower)) {
    const from = zones[0].offset, to = zones.at(-1).offset
    if (from !== to) {
      const shifted = times[0].minutes - from * 60 + to * 60
      const dayNote = shifted >= 1440 ? ' (next day)' : shifted < 0 ? ' (previous day)' : ''
      lines.push(`${showClock(times[0].minutes)} at UTC${from >= 0 ? '+' : ''}${from} is ${showClock(shifted)}${dayNote} at UTC${to >= 0 ? '+' : ''}${to}.`)
      return lines
    }
  }
  if (times.length >= 3) {
    const gaps = times.slice(1).map((t, i) => t.minutes - times[i].minutes)
    const nth = /\b(\d+)(?:st|nd|rd|th)\b/i.exec(text)?.[1] ?? ORDINALS[/\b(first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|eleventh|twelfth)\b/i.exec(text)?.[1]?.toLowerCase()]
    if (gaps[0] > 0 && gaps.every(g => g === gaps[0]) && nth) {
      const n = Number(nth)
      lines.push(`The times are ${gaps[0]} minutes apart, so the ${n}th is ${showClock(times[0].minutes + (n - 1) * gaps[0], times[0].hasMeridiem ? '12' : '24')}.`)
    }
    return lines
  }
  const spans = durations(text)
  if (times.length === 2 && spans.length === 0 && /\b(?:how (?:many|much|long)|minutes|hours|between|from)\b/.test(lower)) {
    const [a, b] = times
    if ((a.hasMeridiem && b.hasMeridiem) || (a.twentyFour || b.twentyFour) || (!a.hasMeridiem && !b.hasMeridiem && b.minutes > a.minutes)) {
      const span = mod(b.minutes - a.minutes, 1440)
      lines.push(`From ${showClock(a.minutes, a.hasMeridiem ? '12' : '24')} to ${showClock(b.minutes, b.hasMeridiem ? '12' : '24')}${b.minutes < a.minutes ? ' (next day)' : ''} is ${showSpan(span)}.`)
    }
    return lines
  }
  if (times.length === 1 && spans.length >= 1 && !/\bevery\b/.test(lower) && /\b(?:what time|when|ends?|finish|done|over|arrive|until)\b/.test(lower)) {
    const back = /\b(?:before|earlier|ago|early)\b/.test(lower)
    // "lasts 95 minutes, then a 20-minute break" adds what follows the time; "40 minutes before 8:15" may come first.
    const after = back ? (spans.length === 1 ? spans : []) : spans.filter(s => s.at > times[0].at)
    if (!after.length) return lines
    const total = after.reduce((sum, s) => sum + s.minutes, 0)
    if (!Number.isInteger(total)) return lines
    const end = times[0].minutes + (back ? -total : total)
    lines.push(`${showClock(times[0].minutes, times[0].hasMeridiem ? '12' : '24')} ${back ? '-' : '+'} ${after.map(s => s.minutes).join(' + ')} minutes = ${showClock(end, times[0].hasMeridiem ? '12' : '24')}${end >= 1440 ? ' (next day)' : end < 0 ? ' (previous day)' : ''}.`)
  }
  return lines
}

function otherLines(text) {
  const lines = [], lower = text.toLowerCase()
  const every = [...lower.matchAll(/\bevery (\d+) (days?|hours?|minutes?|weeks?)\b/g)]
  if (every.length >= 2 && every.every(m => m[2].replace(/s$/, '') === every[0][2].replace(/s$/, '')) && /\b(?:same|together|both|again|next)\b/.test(lower)) {
    const ns = every.map(m => Number(m[1])), lcm = ns.reduce((a, b) => (a * b) / gcd(a, b))
    lines.push(`Every ${ns.join(' and every ')} ${every[0][2].replace(/s?$/, 's')} line up again after ${lcm} ${every[0][2].replace(/s?$/, 's')} (least common multiple).`)
  }
  const split = /\b(\d+)\s*minutes?\b[^.?!]*\bhours? and minutes\b|\bhours? and minutes\b[^.?!]*?\b(\d+)\s*minutes?\b/i.exec(text)
  if (split) { const n = Number(split[1] ?? split[2]); lines.push(`${n} minutes = ${Math.floor(n / 60)} h ${n % 60} min.`) }
  return lines
}

/** The app fact for a clock, time-zone or calendar question, or ''. Never throws. */
export function timeMathBlock(text, { now = new Date() } = {}) {
  try {
    const raw = String(text ?? '')
    if (!raw || raw.length > MAX_TEXT || /```/.test(raw)) return ''
    // A format example ("Reply like 1:05 PM") is not a time in the question.
    const value = raw.replace(/\b(?:like|e\.g\.?|such as|format)\s+\d{1,2}:\d{2}(?:\s*[ap]\.?\s?m\b\.?)?/gi, '')
    const lines = [...clockLines(value), ...weekdayLines(value, now), ...otherLines(value)]
    return lines.length ? `${TIME_MATH_HEADER}\n${lines.map(line => `- ${line}`).join('\n')}` : ''
  } catch { return '' }
}
