import { appendFileSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { isCorrection } from './nori-learning.mjs'

// Nori's experience journal: every finished reply is logged with what kind of
// ability handled it and whether it worked. Requests she had to decline go to a
// wishlist, so what she cannot do yet becomes the list of what to build next.
// Data stays in Nori's data folder; it is context for reports, never authority.
const MAX_JOURNAL_BYTES = 2 * 1024 * 1024
const MAX_WISHES = 200
const DECLINED = /\b(?:i can'?t|i cannot|i'?m (?:not able|unable)|i am (?:not able|unable)|i don'?t have (?:a|the|any) (?:tool|way|ability|access)|isn'?t (?:something i can|supported)|not (?:yet )?supported|no (?:tool|ability) (?:for|to))\b/i
const FAILED = /\b(?:couldn'?t|could not|didn'?t (?:finish|work|accept)|did not (?:finish|work)|failed|error|no app draft was saved|nothing was (?:built|saved|paired|changed)|stopped or timed out|not confirmed)\b/i

function journalDir(dataRoot) { return path.join(dataRoot, 'learning') }
const clip = (text, size) => { const line = String(text ?? '').replace(/\s+/g, ' ').trim(); return line.length > size ? `${line.slice(0, size)}…` : line }

export function classifyReply(reply) {
  const text = String(reply ?? '')
  const kind = /^Done: .*lights? (?:are|is)|^Your Hue Bridge|Hue Bridge/.test(text) ? 'lights'
    : /^(?:Done: (?:TV |I sent the power-off button to your TV\.|[\w+ ]+ is open on your TV\.)|The TV reports [\w+ ]+ is open\.|I sent the TV |I sent the [\w+ ]+ launch request, but could not confirm it opened\.|Your TV(?: is | reports it is already on\.)|Paired after the TV accepted the connection\.|The TV (?:did not report|did not authorize|request may be partially sent|denied pairing|did not confirm pairing)|I (?:am not paired with a verified local TV\.|could not confirm (?:TV pairing|the TV(?: wake signal| control request))|do not have a verified state-setting power-off command\.|cannot verify the TV’s mute state|cannot wake the TV because)|I (?:sent the wake-up signal to your TV\.|couldn't confirm the TV request completed\.|asked the TV to open |can't wake the TV because |couldn't reach your TV\.)|I'm not paired with your TV yet\.|The TV (?:no longer accepts|said no)|Paired\. I can control your TV now;)/.test(text) ? 'tv'
    : /^I scanned your home network|^Saved: .* is now "/.test(text) ? 'network'
      : /^(?:I sent Windows an activation request for \*\*|Start-menu entry found: |No verified matching Start-menu entry was found|App launch is not confirmed\.|No app request was sent\.|I couldn't confirm the app request completed\.)/.test(text) ? 'apps'
      : /^REA (?:finished|connection)|Nori’s REA|Nori's REA/.test(text) ? 'reverse-engineering'
        : /Nori-local app proposal|No app draft was saved/.test(text) ? 'app-draft'
          : /\b(?:°F|°C)\b/.test(text) ? 'weather' : 'conversation'
  const outcome = DECLINED.test(text) ? 'declined' : FAILED.test(text) ? 'failed' : 'ok'
  return { kind, outcome }
}

function readWishes(file) {
  try {
    const value = JSON.parse(readFileSync(file, 'utf8'))
    if (value?.schema === 'nori.wishlist.v1' && Array.isArray(value.wishes)) return value
  } catch {}
  return { schema: 'nori.wishlist.v1', wishes: [] }
}

function wishKey(request) { return String(request).toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120) }

const SLOW_SECONDS = 60
const words = text => new Set(String(text ?? '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/).filter(word => word.length > 2))
// Same question again within 15 minutes (most of its words repeated) means the last answer did not land.
export function isRepeat(request, previous) {
  const a = words(request), b = words(previous)
  if (a.size < 2 || b.size < 2) return false
  let shared = 0
  for (const word of a) if (b.has(word)) shared++
  return shared / Math.max(a.size, b.size) >= 0.8
}
function lastEntry(journal) {
  try {
    const text = readFileSync(journal, 'utf8').trimEnd()
    return JSON.parse(text.slice(text.lastIndexOf('\n') + 1))
  } catch { return null }
}

// Signals beyond the reply's wording: the owner's next message correcting it, the owner asking
// again, an empty reply, or a slow one. A correction or repeat is about the PREVIOUS reply.
export function experienceSignals({ request, reply, seconds, previous, now = new Date() }) {
  const signals = []
  const age = previous ? now.getTime() - Date.parse(previous.at) : Infinity
  if (age < 30 * 60_000 && isCorrection(request)) signals.push('corrects-previous')
  if (age < 15 * 60_000 && isRepeat(request, previous.request)) signals.push('repeats-previous')
  if (!String(reply ?? '').trim()) signals.push('empty')
  if (Number.isFinite(seconds) && seconds > SLOW_SECONDS) signals.push('slow')
  return signals
}

/** Appends one finished exchange; returns the classification. Never throws. */
// Condenses the text service's speed records for one turn (all model calls since it started)
// into the numbers that explain a slow reply: model wait/load, first token, output speed, RAM.
export function summarizeTurnTimings(records, sinceMs) {
  const calls = (Array.isArray(records) ? records : []).filter(record => record && Number.isFinite(record.startedAt) && record.startedAt >= sinceMs)
  if (!calls.length) return null
  const secs = ms => Math.round(ms / 100) / 10
  const pick = (key, fn) => { const values = calls.map(call => call[key]).filter(Number.isFinite); return values.length ? fn(...values) : undefined }
  const summary = {
    calls: calls.length,
    modelSeconds: secs(calls.reduce((sum, call) => sum + (Number.isFinite(call.totalMs) ? call.totalMs : 0), 0)),
    waitSeconds: pick('routeMs', Math.max) === undefined ? undefined : secs(pick('routeMs', Math.max)),
    firstTokenSeconds: Number.isFinite(calls[0].firstTokenMs) ? secs(calls[0].firstTokenMs) : undefined,
    tokensPerSecond: pick('outputPerSecond', Math.min),
    outputTokens: pick('outputTokens', (...values) => values.reduce((a, b) => a + b, 0)),
    freeRamMiB: pick('freeRamMiB', Math.min),
    ...(calls.some(call => call.outcome && call.outcome !== 'ok') ? { notOk: calls.filter(call => call.outcome !== 'ok').map(call => call.outcome).slice(0, 4) } : {}),
  }
  return Object.fromEntries(Object.entries(summary).filter(([, value]) => value !== undefined))
}

export function recordExperience(dataRoot, { request, reply, seconds, model, timing, now = new Date() } = {}) {
  try {
    if (typeof dataRoot !== 'string' || !dataRoot || !String(request ?? '').trim()) return null
    const classified = classifyReply(reply)
    const kind = classified.kind
    const dir = journalDir(dataRoot)
    mkdirSync(dir, { recursive: true })
    const journal = path.join(dir, 'experience.jsonl')
    const signals = experienceSignals({ request, reply, seconds, previous: lastEntry(journal), now })
    const outcome = signals.includes('empty') ? 'failed' : classified.outcome
    const entry = { at: now.toISOString(), kind, outcome, request: clip(request, 300), reply: clip(reply, 240),
      ...(Number.isFinite(seconds) ? { seconds: Math.round(seconds * 10) / 10 } : {}),
      ...(typeof model === 'string' && model ? { model: clip(model, 40) } : {}),
      ...(timing && typeof timing === 'object' ? { timing } : {}),
      ...(signals.length ? { signals } : {}) }
    appendFileSync(journal, `${JSON.stringify(entry)}\n`, 'utf8')
    try {
      if (statSync(journal).size > MAX_JOURNAL_BYTES) {
        const lines = readFileSync(journal, 'utf8').trim().split('\n')
        writeFileSync(`${journal}.tmp`, `${lines.slice(Math.floor(lines.length / 2)).join('\n')}\n`, 'utf8')
        renameSync(`${journal}.tmp`, journal)
      }
    } catch {}
    if (outcome === 'declined') {
      const file = path.join(dir, 'wishlist.json')
      const wishlist = readWishes(file)
      const key = wishKey(request)
      const existing = wishlist.wishes.find(wish => wish.key === key)
      if (existing) { existing.count += 1; existing.last = now.toISOString() }
      else wishlist.wishes.push({ key, request: clip(request, 300), count: 1, first: now.toISOString(), last: now.toISOString() })
      wishlist.wishes = wishlist.wishes.sort((a, b) => b.count - a.count || b.last.localeCompare(a.last)).slice(0, MAX_WISHES)
      writeFileSync(`${file}.tmp`, `${JSON.stringify(wishlist, null, 1)}\n`, 'utf8')
      renameSync(`${file}.tmp`, file)
    }
    return { kind, outcome, signals }
  } catch { return null }
}

export function requestsLearningReport(text) {
  // End-anchored, so "what did you learn in school?" stays an ordinary question.
  return /\bwhat (?:have|did) you (?:learn(?:ed|t)?|picked up)(?:\s+(?:so far|lately|recently|from me|from us|today|this week))?\s*[?.!]*$/i.test(String(text ?? '').trim())
    || /\byour (?:wish ?list)\b|\bwhat can'?t you do yet\b|\bhow (?:have|are) you (?:evolv|improv|grow|learn)\w*/i.test(String(text ?? ''))
}

/** Owner-facing report built from her real lessons, journal and wishlist. */
export function learningReport(dataRoot, { lessons = [], now = new Date(), days = 7 } = {}) {
  const dir = journalDir(dataRoot)
  let entries = []
  try {
    entries = readFileSync(path.join(dir, 'experience.jsonl'), 'utf8').trim().split('\n')
      .map(line => { try { return JSON.parse(line) } catch { return null } }).filter(Boolean)
  } catch {}
  const since = now.getTime() - days * 86_400_000
  const recent = entries.filter(entry => Date.parse(entry.at) >= since)
  const byKind = {}
  for (const entry of recent) {
    const row = (byKind[entry.kind] ??= { ok: 0, failed: 0, declined: 0 })
    row[entry.outcome] = (row[entry.outcome] ?? 0) + 1
  }
  const wishes = readWishes(path.join(dir, 'wishlist.json')).wishes.slice(0, 5)
  const out = [`Here's what I've actually learned and done, from my own records (not a guess).`]
  out.push('', `**Lessons you've taught me:** ${lessons.length}`)
  for (const lesson of lessons.slice(-3).reverse()) out.push(`- ${clip(lesson, 160)}`)
  out.push('', `**My last ${days} days:** ${recent.length} replies`)
  for (const [kind, row] of Object.entries(byKind).sort((a, b) => (b[1].ok + b[1].failed + b[1].declined) - (a[1].ok + a[1].failed + a[1].declined)))
    out.push(`- ${kind}: ${row.ok} worked${row.failed ? `, ${row.failed} failed` : ''}${row.declined ? `, ${row.declined} I couldn't do` : ''}`)
  const count = signal => recent.filter(entry => entry.signals?.includes(signal)).length
  const flagged = [['corrects-previous', 'you corrected me'], ['repeats-previous', 'you had to ask again'], ['slow', 'a reply took over a minute'], ['empty', 'a reply came back empty']]
    .map(([signal, text]) => [count(signal), text]).filter(([n]) => n)
  if (flagged.length) out.push(`- Beyond my own wording: ${flagged.map(([n, text]) => `${n}x ${text}`).join('; ')}.`)
  out.push('', wishes.length ? '**My wishlist** (things you asked that I can\'t do yet):' : '**My wishlist** is empty so far: nothing you\'ve asked has been out of reach yet.')
  for (const wish of wishes) out.push(`- "${clip(wish.request, 100)}"${wish.count > 1 ? ` (asked ${wish.count} times)` : ''}`)
  return out.join('\n')
}
