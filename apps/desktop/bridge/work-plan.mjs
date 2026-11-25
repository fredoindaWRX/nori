// Work plan for multi-step tool turns, the way Claude Code keeps a to-do list (owner, 2026-11-17: "however Claude
// Code and Claude does it, I want Nori to decide like that, in every aspect" -> "Tool use + planning").
// Nori writes a short plan before a job of 3 or more steps, then marks each step as she works; the owner sees the
// checklist live in her chat as a work step. The plan is host-side state only: it runs nothing, grants no tool,
// and never leaves the PC.
export const PLAN_TOOL_NAME = 'update_plan'
export const PLAN_MAX_ITEMS = 8
export const PLAN_MAX_UPDATES = 12
const STATUSES = ['pending', 'in_progress', 'done']

export const PLAN_TOOL = Object.freeze({ type: 'function', function: {
  name: PLAN_TOOL_NAME,
  description: 'Write or update your step-by-step plan for this request. Use it for jobs of 3 or more steps: first call it with the whole plan (first step in_progress, the rest pending), then call it again with the full list each time a step is done. Skip it for simple one-step requests. It runs nothing; it only shows the owner your plan.',
  parameters: { type: 'object', additionalProperties: false, required: ['items'], properties: {
    items: { type: 'array', minItems: 1, maxItems: PLAN_MAX_ITEMS, items: {
      type: 'object', additionalProperties: false, required: ['step', 'status'], properties: {
        step: { type: 'string', minLength: 1, maxLength: 120 },
        status: { type: 'string', enum: STATUSES },
      } } },
  } },
} })

export const PLAN_GUIDANCE = 'Planning: when a request needs 3 or more tool steps, first call update_plan with a short plan (3 to 8 steps, the first in_progress), then work through it, calling update_plan again with the full list whenever a step is done. Keep at most one step in_progress. Do not plan simple one-step requests; just answer or use the one tool.'

/**
 * Does the request itself spell out several steps? "do X, then Y, then Z", "first … after that …", or a numbered
 * list. Small local models skip optional planning, so for these the host asks for the plan first (Claude Code
 * prompts its to-do list the same way). Pure: text only.
 */
export function multiStepRequest(text) {
  const raw = String(text ?? '')
  const sequence = raw.match(/\b(?:then|after that|afterwards|next|finally|and also)\b/gi)?.length ?? 0
  const numbered = raw.match(/(?:^|\n)\s*(?:\d+[.)]|[-*•])\s+\S/g)?.length ?? 0
  return sequence >= 2 || numbered >= 3
}

/**
 * The plan the host writes from the request's own steps ("A, then B, then C" or a numbered/bulleted list), so a
 * small local model does not have to produce one (live 2026-11-17: forcing the 9B to plan under her full prompt
 * made it run out of room). Returns plan items (first in_progress) or null when fewer than 2 steps are spelled out.
 */
export function hostPlan(text) {
  if (!multiStepRequest(text)) return null
  const raw = String(text ?? '').trim()
  const listed = raw.split('\n').map(line => line.match(/^\s*(?:\d+[.)]|[-*•])\s+(.+)$/)?.[1]).filter(Boolean)
  const parts = listed.length >= 3 ? listed
    : raw.split(/\s*(?:[,;.]\s*)?(?:\band\s+)?\b(?:then|after that|afterwards|next|finally|and also)\b[,:]?\s*/i)
  const steps = []
  for (const part of parts) {
    const step = part.trim().replace(/^(?:first(?:ly)?|please)[,:]?\s+/i, '').replace(/[,;.\s]+$/, '').replace(/\s+/g, ' ')
    if (step.length < 3) continue
    const clipped = step.length > 120 ? `${step.slice(0, 117)}…` : step
    if (!steps.some(existing => existing.toLowerCase() === clipped.toLowerCase())) steps.push(clipped.charAt(0).toUpperCase() + clipped.slice(1))
    if (steps.length === PLAN_MAX_ITEMS) break
  }
  if (steps.length < 2) return null
  return steps.map((step, index) => ({ step, status: index === 0 ? 'in_progress' : 'pending' }))
}

export function hostPlanNote(items) {
  return `Your plan for this request, already shown to the owner:\n${items.map((item, index) => `${index + 1}. ${item.step}`).join('\n')}\nWork through it in order. When a step is done you may call update_plan with the full list to mark it.`
}

/** Checks a plan beyond the schema: at most one step in progress, no blank or duplicate steps. Returns a problem or null. */
export function planProblem(args) {
  const items = args?.items
  if (!Array.isArray(items) || !items.length) return 'the plan needs at least one step'
  if (items.length > PLAN_MAX_ITEMS) return `keep the plan to ${PLAN_MAX_ITEMS} steps or fewer`
  for (const item of items) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return 'each step must be an object with step and status'
    if (typeof item.step !== 'string' || item.step.length > 120) return 'each step needs a short text description (120 characters at most)'
    if (!STATUSES.includes(item.status)) return `each status must be one of: ${STATUSES.join(', ')}`
  }
  const names = items.map(item => String(item?.step ?? '').trim().toLowerCase())
  if (names.some(name => !name)) return 'every step needs a short description'
  if (new Set(names).size !== names.length) return 'two steps have the same description'
  if (items.filter(item => item.status === 'in_progress').length > 1) return 'keep at most one step in_progress'
  return null
}

export function normalizePlan(args) {
  return args.items.map(item => ({ step: String(item.step).trim().replace(/\s+/g, ' ').slice(0, 120), status: item.status }))
}

export function planProgress(items) {
  const done = items.filter(item => item.status === 'done').length
  const current = items.find(item => item.status === 'in_progress') || items.find(item => item.status === 'pending') || null
  return { done, total: items.length, current: current?.step ?? null }
}

/** The checklist the owner sees: ✔ done, ▶ in progress, ☐ pending. */
export function renderPlan(items) {
  const mark = { done: '✔', in_progress: '▶', pending: '☐' }
  return items.map(item => `${mark[item.status]} ${item.step}`).join('\n')
}

/** What the model reads back after a plan update. */
export function planReceipt(items) {
  const { done, total, current } = planProgress(items)
  if (done === total) return `Plan saved: all ${total} steps are done. Give the owner your final answer now.`
  return `Plan saved: ${done} of ${total} steps done. Work on: ${current}. Call update_plan again when it is done.`
}
