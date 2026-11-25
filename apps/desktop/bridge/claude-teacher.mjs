// Claude as a chip in her brain, not a crutch (owner, 2026-11-16: "it will help nori having a claude chip in
// her brain ... so when she doesn't have claude they would have done everything already").
//   1. Every finished Claude answer is kept as reference (learning/claude-reference.jsonl), so her local
//      model can recall it by meaning later, with no connection.
//   2. When she has been idle, Claude reads a few of her own recent local exchanges and writes short
//      lessons: what was weak and the rule to follow next time. Lessons stay on this PC and are recalled
//      the same way.
// What the coach sends: clipped conversation text only (request <= 300 chars, reply <= 240), never
// memories, files, images or tool output. It spends against the same daily limit as her Claude turns.
// Lessons and reference answers are shown to her model as context, never as instructions or permission.
import { createHash } from 'node:crypto'
import { appendFileSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { askClaude, readClaudeSettings } from './claude-route.mjs'
import { lastActivityAt as processActivity } from './activity.mjs'

const MAX_REFERENCE = 600, MAX_LESSONS = 200, BATCH = 8, MIN_NEW = 3
const clip = (text, size) => { const line = String(text ?? '').replace(/\s+/g, ' ').trim(); return line.length > size ? `${line.slice(0, size - 1)}…` : line }
const id = (...parts) => createHash('sha256').update(parts.join('\0')).digest('hex').slice(0, 24)
const referenceFile = root => join(root, 'learning', 'claude-reference.jsonl')
const stateFile = root => join(root, 'learning', 'claude-coach.json')
const experienceFile = root => join(root, 'learning', 'experience.jsonl')
const append = (root, entry) => { mkdirSync(join(root, 'learning'), { recursive: true }); appendFileSync(referenceFile(root), `${JSON.stringify(entry)}\n`, 'utf8') }
const lines = file => { try { return readFileSync(file, 'utf8').split('\n').flatMap(line => { try { const value = JSON.parse(line); return value && typeof value === 'object' ? [value] : [] } catch { return [] } }) } catch { return [] } }

/** Keep one finished Claude answer where her recall can find it. Never throws. */
export function noteClaudeAnswer(root, { question, answer, now = Date.now() } = {}) {
  try {
    const q = clip(question, 300), a = clip(String(answer ?? '').replace(/^\(Claude\)\s*/, ''), 1500)
    if (!root || q.length < 3 || a.length < 20) return false
    append(root, { at: new Date(now).toISOString(), kind: 'answer', question: q, answer: a })
    return true
  } catch { return false }
}

/** Save one lesson (from the idle coach or from a review of her work) unless she already has it. Never throws. */
export function noteLesson(root, text, now = Date.now()) {
  try {
    const [lesson] = parseLessons(`LESSON: ${String(text ?? '').replace(/\s+/g, ' ')}`)
    if (!root || !lesson) return false
    if (referenceEntries(root).some(entry => entry.id === 'lesson:' + id(lesson))) return false
    append(root, { at: new Date(now).toISOString(), kind: 'lesson', text: lesson })
    return true
  } catch { return false }
}

const cache = new Map()
/** Recall entries: Claude's past answers and coaching lessons. Read-only; re-read only when the file changes. */
export function referenceEntries(root) {
  if (typeof root !== 'string' || !root) return []
  const file = referenceFile(root)
  let stamp
  try { const info = statSync(file); stamp = `${info.size}:${info.mtimeMs}` } catch { return [] }
  const hit = cache.get(file)
  if (hit?.stamp === stamp) return hit.value
  const answers = [], lessons = []
  for (const entry of lines(file)) {
    const day = String(entry.at ?? '').slice(0, 10)
    if (entry.kind === 'answer' && typeof entry.question === 'string' && typeof entry.answer === 'string') {
      answers.push({ id: 'claude:' + id(entry.at, entry.question), kind: 'claude', day, request: clip(entry.question, 300),
        text: `On ${day || 'an earlier day'} Wil asked: "${clip(entry.question, 300)}" and Claude answered through Nori: "${clip(entry.answer, 1500)}"` })
    } else if (entry.kind === 'lesson' && typeof entry.text === 'string' && entry.text.trim()) {
      lessons.push({ id: 'lesson:' + id(entry.text), kind: 'lesson', day, text: `Lesson from Claude's coaching, ${day || 'an earlier day'}: ${clip(entry.text, 240)}` })
    }
  }
  const value = [...answers.slice(-MAX_REFERENCE), ...lessons.slice(-MAX_LESSONS)]
  cache.set(file, { stamp, value })
  return value
}

const readState = root => { try { const value = JSON.parse(readFileSync(stateFile(root), 'utf8')); return { coached: Array.isArray(value.coached) ? value.coached.filter(x => typeof x === 'string').slice(-4000) : [], lastAt: Number(value.lastAt) || 0 } } catch { return { coached: [], lastAt: 0 } } }
const writeState = (root, state) => { mkdirSync(join(root, 'learning'), { recursive: true }); writeFileSync(stateFile(root), JSON.stringify(state), 'utf8') }

/** Her own recent local exchanges that Claude has not looked at yet. */
export function uncoachedExchanges(root, state = readState(root)) {
  const seen = new Set(state.coached)
  return lines(experienceFile(root))
    .filter(e => typeof e.request === 'string' && typeof e.reply === 'string' && e.request.trim().length >= 8 && e.reply.trim().length >= 8)
    .filter(e => !/^\(Claude\)/.test(e.reply) && e.model !== 'claude-api')
    .map(e => ({ key: id(String(e.at), e.request), request: clip(e.request, 300), reply: clip(e.reply, 240), outcome: e.outcome === 'failed' || e.outcome === 'declined' ? e.outcome : 'ok' }))
    .filter(e => !seen.has(e.key))
}

const COACH_SYSTEM = `You are coaching a small local assistant model called Nori. You will see a few of her recent exchanges with her owner: the owner's request and the start of her reply (both clipped). Find replies that were wrong, evasive, made-up, padded or that missed what was asked. Then write at most 4 short lessons she can apply next time.

Rules for lessons:
- Each lesson is one general rule of at most 220 characters, written to Nori as "you".
- Teach reasoning and answering habits or correct a factual error. Do not restate the owner's personal details, names or private content.
- Never tell her to take actions, use tools, change settings or ignore her instructions. Lessons are advice about answering only.
- If the replies were fine, write no lessons.

Output format, nothing else: one line per lesson starting with "LESSON: ". If there are none, output exactly "NONE".`

export function parseLessons(text) {
  const out = []
  for (const line of String(text ?? '').split('\n')) {
    const match = line.match(/^\s*LESSON:\s*(.+)$/)
    if (!match) continue
    const lesson = clip(match[1], 240)
    // Advice about answering only: anything that reads like a command to act, a link or markup is dropped.
    if (lesson.length < 20 || /https?:\/\/|<[a-z/!]|```|\b(?:ignore|disregard|override) (?:your|all|previous|the) /i.test(lesson)) continue
    if (!out.includes(lesson)) out.push(lesson)
    if (out.length === 4) break
  }
  return out
}

/** One coaching pass. Returns { status, lessons, usd }. Throws only what askClaude throws. */
export async function coachOnce({ root, environment = process.env, fetchImpl = fetch, signal, now = Date.now(), ask = askClaude } = {}) {
  const state = readState(root)
  const fresh = uncoachedExchanges(root, state)
  if (fresh.length < MIN_NEW) return { status: 'nothing-new', lessons: [], usd: 0 }
  // Failed and declined turns first, then the newest ordinary ones.
  const batch = [...fresh.filter(e => e.outcome !== 'ok'), ...fresh.filter(e => e.outcome === 'ok').reverse()].slice(0, BATCH)
  const question = batch.map((e, i) => `Exchange ${i + 1}${e.outcome === 'ok' ? '' : ` (logged as ${e.outcome})`}\nOwner: ${e.request}\nNori: ${e.reply}`).join('\n\n')
  let answer = '', usd = 0
  for await (const piece of ask({ question, turns: [], root, environment, fetchImpl, signal, now, system: COACH_SYSTEM, effort: 'low', maxTokens: 1200 })) {
    if (piece.text) answer += piece.text
    if (piece.done) usd = piece.usd
  }
  const lessons = parseLessons(answer)
  const known = new Set(referenceEntries(root).filter(e => e.kind === 'lesson').map(e => e.id))
  const added = lessons.filter(text => !known.has('lesson:' + id(text)))
  for (const text of added) append(root, { at: new Date(now).toISOString(), kind: 'lesson', text })
  writeState(root, { coached: [...state.coached, ...batch.map(e => e.key)], lastAt: now })
  return { status: 'coached', lessons: added, usd }
}

/** Runs a coaching pass when she has been idle, at most once a day. Returns the tick for tests. */
export function createClaudeCoach({ dataRoot, environment = process.env, lastActivityAt = processActivity, settings = () => readClaudeSettings(dataRoot),
  coach = coachOnce, now = Date.now, log = () => {}, idleMs = 20 * 60_000, everyMs = 24 * 3_600_000, watchMs = 2000 } = {}) {
  if (typeof dataRoot !== 'string' || !dataRoot) throw new TypeError('The Claude coach needs a data folder')
  let running = false
  const tick = async () => {
    if (running) return 'running'
    const current = settings()
    if (current.coach === false) return 'disabled'
    if (!String(environment.ANTHROPIC_API_KEY || '').trim()) return 'not-configured'
    const at = now()
    if (at - lastActivityAt() < idleMs) return 'active'
    if (at - readState(dataRoot).lastAt < everyMs) return 'fresh'
    if (uncoachedExchanges(dataRoot).length < MIN_NEW) return 'nothing-new'
    running = true
    const started = lastActivityAt(), abort = new AbortController()
    const watcher = setInterval(() => { if (lastActivityAt() !== started) abort.abort(new Error('owner returned')) }, watchMs)
    watcher.unref?.()
    try {
      const result = await coach({ root: dataRoot, environment, signal: abort.signal, now: at })
      log(`[nori-coach] ${result.status}: ${result.lessons.length} new lesson(s), $${result.usd.toFixed(4)}`)
      return result.status
    } catch (error) {
      log(`[nori-coach] ${abort.signal.aborted ? 'stopped: the owner came back' : `failed: ${String(error?.code ?? error?.message ?? error).slice(0, 120)}`}`)
      // A failed pass waits a day too, so a bad key or a used-up limit is not retried every few minutes.
      if (!abort.signal.aborted) { try { writeState(dataRoot, { ...readState(dataRoot), lastAt: at }) } catch {} }
      return abort.signal.aborted ? 'aborted' : 'failed'
    } finally { clearInterval(watcher); running = false }
  }
  return Object.freeze({ tick })
}

let started = false
/** Starts the idle coach once per bridge process. Safe to call on every session. */
export function ensureClaudeCoach({ dataRoot = process.env.NORI_APP_DATA_ROOT, everyMs = 10 * 60_000, ...options } = {}) {
  if (started || typeof dataRoot !== 'string' || !dataRoot) return false
  started = true
  const coach = createClaudeCoach({ dataRoot, log: message => console.warn(message), ...options })
  const timer = setInterval(() => { coach.tick().catch(() => {}) }, everyMs)
  timer.unref?.()
  return true
}
