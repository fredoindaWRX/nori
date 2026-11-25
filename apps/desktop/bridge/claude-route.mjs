// Hybrid brain (owner, 2026-11-16: "yes go ahead and build the hybrid"). Nori stays local for everyday
// talk; one turn goes to the Claude API when the owner asks for Claude by name, or (automatic mode) when
// a text-only request looks like hard thinking and nothing in it points at this PC.
//
// What leaves the PC on such a turn: her persona text, the last 8 conversation turns (clipped) and the new
// message. Never memories, files, screen reads, images or attachments, and Claude gets no tools.
// Spend is capped per day from the token counts the API reports. Raw HTTPS with fetch on purpose: the
// app ships no Anthropic SDK and adding a dependency needs the owner's OK.
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { NORI_PERSONA } from './nori-identity.mjs'

export const CLAUDE_ENDPOINT = 'https://api.anthropic.com/v1/messages'
export const CLAUDE_MODEL = 'claude-opus-5-5'
// USD per million tokens (input, output), for the daily cap estimate only.
const PRICES = { 'claude-opus-5-5': [4, 20], 'claude-sonnet-5-5': [2, 10], 'claude-haiku-5-5': [0.1, 0.5], 'claude-fable-5-2': [8, 40] }
const DEFAULTS = Object.freeze({ auto: true, dailyUsd: 2, model: CLAUDE_MODEL, coach: true, review: true })
// A key that is not tied to one workspace needs the workspace named on every request (an id, not a secret).
const WORKSPACE = /^[A-Za-z0-9_-]{6,80}$/
const MAX_TURNS = 8, MAX_TURN_CHARS = 1500, MAX_OUTPUT_TOKENS = 4000   // kept small to save tokens (owner, 2026-11-16)

const NAME = '(?:claude|calude|cluade|claud)'
const ASK = new RegExp(`^\\s*(?:hey\\s+)?(?:(?:ask|use|with|have|let)\\s+${NAME}(?:\\s+(?:to|for|about|answer))?|${NAME})\\s*[:,-]?\\s+`, 'i')
const ASK_TAIL = new RegExp(`[\\s,.;]+(?:(?:ask|use|with)\\s+${NAME}|${NAME}\\s+please)\\s*[.!?]*\\s*$`, 'i')
// The request names something on this PC or one of her own local abilities: it stays local.
const LOCAL = /\b(?:lights?|lamp|open|launch|close|install|uninstall|remember|forget|my (?:files?|folder|documents?|pc|computer|screen|desktop|phone|memory|memories|journal|project)|this (?:pc|computer|screen|window|file|folder|project)|screenshot|camera|webcam|timer|alarm|volume|play|pause|skill|draw|image|picture|photo|video|render|search (?:for|the web)|look up|browse|website|download|obs|stream|vram|gpu|ram|hub|aider|rea\b|artcraft|wordcraft|filmcraft|soundcraft|home status|power)\b/i
const HARD = /\b(?:explain|analy[sz]e|compare|contrast|evaluate|critique|review|summari[sz]e|plan|strategy|roadmap|design|architect|debug|refactor|optimi[sz]e|prove|derive|step[- ]by[- ]step|pros and cons|trade-?offs?|why (?:does|do|is|are|did|would)|how (?:should|would|could|does|do) |what (?:would|should) |write (?:me |an? |the |some )|draft|essay|article|outline|brainstorm|advice|recommend)\b/i

const settingsFile = root => join(root, 'learning', 'claude-mode.json')
const usageFile = root => join(root, 'learning', 'claude-usage.jsonl')
export function readClaudeSettings(root) {
  try {
    const raw = JSON.parse(readFileSync(settingsFile(root), 'utf8'))
    const daily = Number(raw.dailyUsd)
    return { auto: raw.auto !== false, dailyUsd: Number.isFinite(daily) && daily >= 0 && daily <= 100 ? daily : DEFAULTS.dailyUsd, model: PRICES[raw.model] ? raw.model : DEFAULTS.model, coach: raw.coach !== false, review: raw.review !== false,
      ...(WORKSPACE.test(raw.workspaceId ?? '') ? { workspaceId: raw.workspaceId } : {}) }
  } catch { return { ...DEFAULTS } }
}
export function writeClaudeSettings(root, next) {
  const value = { ...readClaudeSettings(root), ...next }
  mkdirSync(join(root, 'learning'), { recursive: true })
  writeFileSync(settingsFile(root), JSON.stringify(value), 'utf8')
  return value
}
const dayOf = now => new Date(now).toISOString().slice(0, 10)
export function spentToday(root, now = Date.now()) {
  try {
    const day = dayOf(now)
    return readFileSync(usageFile(root), 'utf8').split('\n').reduce((sum, line) => {
      if (!line.startsWith(`{"day":"${day}"`)) return sum
      try { const usd = Number(JSON.parse(line).usd); return sum + (Number.isFinite(usd) ? usd : 0) } catch { return sum }
    }, 0)
  } catch { return 0 }
}
export function costUsd(model, usage) {
  const [input, output] = PRICES[model] ?? PRICES[CLAUDE_MODEL]
  const read = (usage?.input_tokens ?? 0) + (usage?.cache_creation_input_tokens ?? 0) * 1.25 + (usage?.cache_read_input_tokens ?? 0) * 0.1
  return (read * input + (usage?.output_tokens ?? 0) * output) / 1e6
}

// "turn off claude", "use claude for hard questions", "claude status": a spoken setting, answered locally.
export function claudeSetting(text) {
  const t = String(text ?? '').trim().toLowerCase()
  if (t.length > 90) return null
  if (new RegExp(`^(?:is ${NAME} (?:on|connected|working|set up)|${NAME} status|are you using ${NAME})\\b`).test(t)) return { status: true }
  if (new RegExp(`\\b(?:stop|turn off|no more) (?:the )?(?:${NAME} )?(?:review(?:s|ing)?|checking)\\b|\\b(?:review|big brother) off\\b`).test(t)) return { review: false }
  if (new RegExp(`\\b(?:start|turn on|resume) (?:the )?(?:${NAME} )?(?:review(?:s|ing)?|checking)\\b|\\b(?:review|big brother) on\\b|\\blet ${NAME} (?:check|review) your work\\b`).test(t)) return { review: true }
  if (new RegExp(`\\b(?:stop|turn off|no more) (?:the )?(?:${NAME} )?coach(?:ing)?\\b|\\bcoach(?:ing)? off\\b`).test(t)) return { coach: false }
  if (new RegExp(`\\b(?:start|turn on|resume) (?:the )?(?:${NAME} )?coach(?:ing)?\\b|\\bcoach(?:ing)? on\\b|\\blet ${NAME} (?:coach|teach) you\\b`).test(t)) return { coach: true }
  if (new RegExp(`\\b(?:stop|don'?t|do not|never|quit) (?:using |use |asking |ask )?${NAME}\\b(?! for)|\\bturn (?:off ${NAME}|${NAME} off)\\b|\\b${NAME} off\\b`).test(t)) return { auto: false }
  if (new RegExp(`\\buse ${NAME} for (?:the )?(?:hard|harder|difficult|big|complex)\\b|\\bturn (?:on ${NAME}|${NAME} on)\\b|\\b${NAME} on\\b`).test(t)) return { auto: true }
  return null
}

// Should this turn go to Claude? Returns { question, why } or null. Pure: no network, no files.
export function claudeDecision(text, { auto = true, hasImages = false, hasAttachment = false } = {}) {
  const raw = String(text ?? '').trim()
  if (!raw || hasImages || hasAttachment) return null
  const head = raw.match(ASK)
  if (head && raw.length - head[0].length >= 3) return { question: raw.slice(head[0].length).trim(), why: 'asked' }
  const tail = raw.match(ASK_TAIL)
  if (tail && tail.index >= 3) return { question: raw.slice(0, tail.index).trim(), why: 'asked' }
  if (!auto || LOCAL.test(raw)) return null
  const words = raw.split(/\s+/).length
  if ((HARD.test(raw) && words >= 8) || words >= 60) return { question: raw, why: 'hard' }
  return null
}

function history(turns, question) {
  const out = []
  for (const turn of (Array.isArray(turns) ? turns : []).slice(-MAX_TURNS)) {
    const text = typeof turn?.text === 'string' ? turn.text.trim().slice(0, MAX_TURN_CHARS) : ''
    if (!text) continue
    const role = turn.role === 'user' ? 'user' : 'assistant'
    if (out.length && out[out.length - 1].role === role) out[out.length - 1].content += `\n\n${text}`
    else out.push({ role, content: text })
  }
  while (out.length && out[0].role !== 'user') out.shift()
  if (out.length && out[out.length - 1].role === 'user') out[out.length - 1].content += `\n\n${question}`
  else out.push({ role: 'user', content: question })
  return out
}

async function* sse(response, signal) {
  const reader = response.body.getReader(), decoder = new TextDecoder()
  let buffer = ''
  try {
    while (true) {
      signal?.throwIfAborted()
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split(/\r?\n/); buffer = lines.pop() || ''
      for (const line of lines) {
        if (!line.startsWith('data:')) continue
        const payload = line.slice(5).trim()
        if (payload) yield JSON.parse(payload)
      }
    }
  } finally { reader.releaseLock() }
}

// Streams one answer. Yields { text } pieces, then one { done, answer, usd, model, stop }.
// Throws Error with .code: CLAUDE_NOT_CONFIGURED, CLAUDE_DAILY_CAP, CLAUDE_HTTP_<status>, CLAUDE_REFUSED.
// system / effort / maxTokens are for the coach (claude-teacher.mjs); a chat turn leaves them unset.
export async function* askClaude({ question, turns = [], root, environment = process.env, fetchImpl = fetch, signal, now = Date.now(), system, effort = 'medium', maxTokens = MAX_OUTPUT_TOKENS }) {
  const fail = (code, message) => Object.assign(new Error(message), { code })
  const key = String(environment.ANTHROPIC_API_KEY || '').trim()
  if (!key) throw fail('CLAUDE_NOT_CONFIGURED', 'No Anthropic API key is set for Nori on this PC.')
  const settings = root ? readClaudeSettings(root) : { ...DEFAULTS }
  const spent = root ? spentToday(root, now) : 0
  if (spent >= settings.dailyUsd) throw fail('CLAUDE_DAILY_CAP', `Today's Claude limit of $${settings.dailyUsd.toFixed(2)} is used up ($${spent.toFixed(2)} spent).`)
  const model = settings.model
  const fromEnv = String(environment.ANTHROPIC_WORKSPACE_ID || '').trim()
  const workspace = WORKSPACE.test(fromEnv) ? fromEnv : settings.workspaceId
  const response = await fetchImpl(CLAUDE_ENDPOINT, {
    method: 'POST', signal,
    headers: { accept: 'text/event-stream', 'content-type': 'application/json', 'anthropic-version': '2023-06-01', 'x-api-key': key,
      ...(workspace ? { 'anthropic-workspace-id': workspace } : {}) },
    body: JSON.stringify({
      model, max_tokens: maxTokens, stream: true,
      // Thinking is always on for this model; effort is the control. Medium keeps cost and wait reasonable.
      output_config: { effort },
      system: system ?? `${NORI_PERSONA}\n\nThis one turn is answered through the Claude API because the owner asked for it or the request needed harder thinking. You have no tools here and cannot see this PC, its files, the screen or Nori's saved memories: if the answer needs any of those, say so plainly instead of guessing. Answer the newest message directly. Be concise (owner, 2026-11-16): lead with the answer, keep it to a few sentences or a short list, no preamble and no recap. Go longer only when the owner asks for depth or the task is a piece of writing or code.`,
      messages: history(turns, question),
    }),
  })
  if (!response.ok || !response.body) {
    const detail = await response.text().catch(() => '')
    let message = detail.slice(0, 300)
    try { message = JSON.parse(detail).error?.message?.slice(0, 300) || message } catch {}
    throw fail(`CLAUDE_HTTP_${response.status}`, message || `Claude API answered ${response.status}.`)
  }
  let answer = '', stop = null
  const usage = {}
  try {
    for await (const event of sse(response, signal)) {
      if (event.type === 'error') throw fail('CLAUDE_STREAM', String(event.error?.message || 'Claude API stream error').slice(0, 300))
      if (event.type === 'message_start') Object.assign(usage, event.message?.usage)
      else if (event.type === 'message_delta') { Object.assign(usage, event.usage); stop = event.delta?.stop_reason ?? stop }
      else if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta' && event.delta.text) { answer += event.delta.text; yield { text: event.delta.text } }
    }
  } finally {
    // Whatever was generated is billed, also when the owner stops the reply: record it either way.
    const usd = costUsd(model, usage)
    if (root && (usage.input_tokens || usage.output_tokens)) {
      try { mkdirSync(join(root, 'learning'), { recursive: true }); appendFileSync(usageFile(root), `${JSON.stringify({ day: dayOf(now), at: new Date(now).toISOString(), model, input: usage.input_tokens ?? 0, output: usage.output_tokens ?? 0, usd: Number(usd.toFixed(6)) })}\n`, 'utf8') } catch {}
    }
  }
  if (stop === 'refusal') throw fail('CLAUDE_REFUSED', 'Claude declined this request.')
  yield { done: true, answer, usd: costUsd(model, usage), model, stop }
}

export function claudeStatusLine(root, environment = process.env, now = Date.now()) {
  const settings = readClaudeSettings(root)
  const key = Boolean(String(environment.ANTHROPIC_API_KEY || '').trim())
  return `Claude is ${key ? 'connected' : 'not connected (no API key reaches me)'}. Automatic use for hard questions is ${settings.auto ? 'on' : 'off'}; asking for Claude by name always works. Coaching while I am idle is ${settings.coach ? 'on' : 'off'}. Checking my work after I use tools is ${settings.review ? 'on' : 'off'}. Model: ${settings.model}. Spent today: $${spentToday(root, now).toFixed(2)} of a $${settings.dailyUsd.toFixed(2)} daily limit. Only the conversation text goes to Claude, never my memories, your files or the screen.`
}
