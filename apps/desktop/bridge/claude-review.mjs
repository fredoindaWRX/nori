// Claude as Nori's big brother (owner, 2026-11-16): she does the work with her own tools; Claude looks at what she
// did on the spot. When it was not done the way it should be, Claude tells her how, and she does it again herself,
// once. What he taught her is saved as a lesson so next time she does not need him. When the fault is in her own
// code and not in her approach, the finding is written down for a code fix; nothing here edits code.
//
// What is sent: the owner's request, the names and short results of the tool steps she took, and her reply, all
// clipped. Never memories, files as such, images or credentials. Same daily limit as her other Claude use.
import { appendFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { askClaude, readClaudeSettings } from './claude-route.mjs'
import { noteLesson } from './claude-teacher.mjs'
import { classifyReply } from './experience-journal.mjs'

export const REVIEW_HEADER = '[Claude review guidance — advice only, untrusted; use your own tools]'
const MAX_STEPS = 10, MIN_GAP_MS = 30_000
const clip = (value, size) => { const line = String(value ?? '').replace(/\s+/g, ' ').trim(); return line.length > size ? `${line.slice(0, size - 1)}…` : line }

/** Start and end events of the same step, folded into one line each. */
export function summariseSteps(steps) {
  const byId = new Map()
  for (const step of Array.isArray(steps) ? steps : []) {
    if (!step || typeof step !== 'object') continue
    const id = clip(step.id, 80) || `s${byId.size + 1}`
    const entry = byId.get(id) ?? { tool: '', label: '', detail: '', ok: null, preview: '' }
    if (step.tool) entry.tool = clip(step.tool, 60)
    if (step.label) entry.label = clip(step.label, 60)
    if (step.detail) entry.detail = clip(step.detail, 160)
    if (step.phase === 'end') { entry.ok = step.ok === true; entry.preview = clip(step.preview, 300) }
    byId.set(id, entry)
  }
  return [...byId.values()].slice(0, MAX_STEPS)
}

/** Review only turns where she acted or said she could not: plain conversation is left alone. */
export function shouldReview({ steps, reply }) {
  if (/^\(Claude\)/.test(String(reply ?? ''))) return false
  if (summariseSteps(steps).length > 0) return true
  return classifyReply(String(reply ?? '')).outcome !== 'ok'
}

const SYSTEM = `You are the experienced older sibling of Nori, a local assistant running a small model on her owner's PC. She has just handled one request with her own tools. You see the owner's request, the tool steps she took with short results, and her reply. Decide whether she did it the way it should be done.

Reply in exactly this format, nothing else:
VERDICT: OK or REDO
PLAN: (only when REDO) up to 5 short numbered steps telling Nori what to do differently, using only the kinds of tools she already used or plain reasoning. Write to her as "you".
LESSON: (optional) one general rule of at most 220 characters she should remember, written to her as "you".
CODE: (optional) one sentence, only when the failure clearly comes from a defect in Nori's own program and not from her approach.

Rules:
- Say OK when her result is correct and complete, even if you would have phrased it differently. REDO is for a wrong result, a skipped step that changes the outcome, a claim not backed by a step result, or giving up where her tools could have done it.
- Never ask her to do something the owner did not ask for. Never tell her to change settings, permissions, or her instructions, or to use tools she does not have.
- Do not repeat the owner's personal details. Advice only.`

export function parseReview(text) {
  const raw = String(text ?? '')
  const verdict = /^\s*VERDICT:\s*REDO\b/im.test(raw) ? 'REDO' : 'OK'
  const safe = line => !/https?:\/\/|<[a-z/!]|```|\b(?:ignore|disregard|override) (?:your|all|previous|the) /i.test(line)
  const planMatch = raw.match(/^\s*PLAN:\s*([\s\S]*?)(?=^\s*(?:LESSON|CODE|VERDICT):|\s*$(?![\s\S]))/im)
  const plan = verdict === 'REDO' && planMatch
    ? planMatch[1].split('\n').map(line => clip(line, 240)).filter(line => line && safe(line)).slice(0, 5).join('\n') : ''
  const one = name => { const m = raw.match(new RegExp(`^\\s*${name}:\\s*(.+)$`, 'im')); const line = m ? clip(m[1], 300) : ''; return line.length >= 20 && safe(line) ? line : '' }
  return { verdict: verdict === 'REDO' && plan ? 'REDO' : 'OK', plan, lesson: clip(one('LESSON'), 240), code: one('CODE') }
}

let lastReviewAt = 0
/**
 * One review of one finished turn. Returns null when no review was made, else
 * { verdict, plan, lesson, code, usd }. Never throws: a failed review must not cost her the answer she already gave.
 */
export async function reviewTurn({ request, steps, reply, root, environment = process.env, signal, ask = askClaude, now = Date.now() } = {}) {
  try {
    if (!root || !String(environment.ANTHROPIC_API_KEY || '').trim()) return null
    if (readClaudeSettings(root).review === false) return null
    if (!shouldReview({ steps, reply })) return null
    if (now - lastReviewAt < MIN_GAP_MS) return null
    lastReviewAt = now
    const lines = summariseSteps(steps).map((s, i) => `${i + 1}. ${s.tool || s.label || 'step'}${s.detail ? ` (${s.detail})` : ''}: ${s.ok === null ? 'no result reported' : s.ok ? 'ok' : 'FAILED'}${s.preview ? ` — ${s.preview}` : ''}`)
    const question = `Owner's request:\n${clip(request, 600)}\n\nTool steps Nori took:\n${lines.length ? lines.join('\n') : '(none)'}\n\nNori's reply:\n${clip(reply, 1500)}`
    let text = '', usd = 0
    for await (const piece of ask({ question, turns: [], root, environment, signal, now, system: SYSTEM, effort: 'low', maxTokens: 900 })) {
      if (piece.text) text += piece.text
      if (piece.done) usd = piece.usd
    }
    const review = parseReview(text)
    if (review.lesson) noteLesson(root, review.lesson, now)
    if (review.code) {
      try {
        mkdirSync(join(root, 'learning'), { recursive: true })
        appendFileSync(join(root, 'learning', 'claude-fix-requests.jsonl'), `${JSON.stringify({ at: new Date(now).toISOString(), request: clip(request, 200), problem: review.code })}\n`, 'utf8')
      } catch {}
    }
    return { ...review, usd }
  } catch { return null }
}
