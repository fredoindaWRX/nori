// OpenAI route (owner, 2026-11-17: "let's put the Codex API credits into Nori too"). Opt-in and OFF by default:
// while it is off Nori stays fully local and free, and nothing here touches the network. When the owner turns it
// on ("turn on openai"), a text-only turn goes to the OpenAI API when he asks for GPT/ChatGPT/OpenAI by name.
// Every such turn costs API money, so spend is capped per day, like the Claude route.
//
// What leaves the PC on such a turn: her persona text, the last 8 conversation turns (clipped) and the new message.
// Never memories, files, screen reads, images or attachments, and the model gets no tools.
// The key comes only from OPENAI_API_KEY in the environment; it is never written to disk or into a log.
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { NORI_PERSONA } from './nori-identity.mjs'

export const OPENAI_ENDPOINT = 'https://api.openai.com/v1/chat/completions'
export const OPENAI_MODEL = 'gpt-5-mini'
// USD per million tokens (input, output), for the daily cap estimate only. Unknown models are priced high on purpose.
const PRICES = { 'gpt-5': [1.25, 10], 'gpt-5-mini': [0.25, 2], 'gpt-5-nano': [0.05, 0.4], 'gpt-5.1': [1.25, 10] }
const UNKNOWN_PRICE = [15, 60]
const MODEL_NAME = /^[A-Za-z0-9][A-Za-z0-9._:-]{1,63}$/
// auto (owner, 2026-11-17: "it should route automatically"): while enabled, hard-thinking turns go to GPT on their
// own (before Claude's automatic mode). It has no effect while the route is off.
// tools (owner, 2026-11-17: "Yes, give them tools"): while enabled, GPT drives her tool loop (her tools still run on
// this PC; their results go to OpenAI). Off by voice: "keep tools local".
const DEFAULTS = Object.freeze({ enabled: false, auto: true, tools: true, dailyUsd: 2, model: OPENAI_MODEL })
const MAX_TURNS = 8, MAX_TURN_CHARS = 1500, MAX_OUTPUT_TOKENS = 4000

const NAME = '(?:chat\\s?gpt|gpt|open\\s?ai)'
const ASK = new RegExp(`^\\s*(?:hey\\s+)?(?:(?:ask|use|with|have|let)\\s+${NAME}(?:\\s+(?:to|for|about|answer))?|${NAME})\\s*[:,-]?\\s+`, 'i')
const ASK_TAIL = new RegExp(`[\\s,.;]+(?:(?:ask|use|with)\\s+${NAME}|${NAME}\\s+please)\\s*[.!?]*\\s*$`, 'i')

const settingsFile = root => join(root, 'learning', 'openai-mode.json')
const usageFile = root => join(root, 'learning', 'openai-usage.jsonl')
export function readOpenAISettings(root) {
  try {
    const raw = JSON.parse(readFileSync(settingsFile(root), 'utf8'))
    const daily = Number(raw.dailyUsd)
    return { enabled: raw.enabled === true, auto: raw.auto !== false, tools: raw.tools !== false,
      dailyUsd: Number.isFinite(daily) && daily >= 0 && daily <= 100 ? daily : DEFAULTS.dailyUsd,
      model: MODEL_NAME.test(raw.model ?? '') ? raw.model : DEFAULTS.model }
  } catch { return { ...DEFAULTS } }
}
export function writeOpenAISettings(root, next) {
  const value = { ...readOpenAISettings(root), ...next }
  mkdirSync(join(root, 'learning'), { recursive: true })
  writeFileSync(settingsFile(root), JSON.stringify(value), 'utf8')
  return value
}
const dayOf = now => new Date(now).toISOString().slice(0, 10)
export function openAISpentToday(root, now = Date.now()) {
  try {
    const day = dayOf(now)
    return readFileSync(usageFile(root), 'utf8').split('\n').reduce((sum, line) => {
      if (!line.startsWith(`{"day":"${day}"`)) return sum
      try { const usd = Number(JSON.parse(line).usd); return sum + (Number.isFinite(usd) ? usd : 0) } catch { return sum }
    }, 0)
  } catch { return 0 }
}
export function openAICostUsd(model, usage) {
  const [input, output] = PRICES[model] ?? UNKNOWN_PRICE
  return ((usage?.prompt_tokens ?? 0) * input + (usage?.completion_tokens ?? 0) * output) / 1e6
}

// "turn on openai", "stop using gpt", "openai status": a spoken or typed setting, answered locally.
export function openAISetting(text) {
  const t = String(text ?? '').trim().toLowerCase()
  if (t.length > 90) return null
  if (new RegExp(`^(?:is ${NAME} (?:on|connected|working|set up)|${NAME} status|are you using ${NAME})\\b`).test(t)) return { status: true }
  if (new RegExp(`\\b(?:stop|don'?t|do not|never|quit) (?:using |use )${NAME}\\b|\\bturn (?:off ${NAME}|${NAME} off)\\b|\\b${NAME} off\\b|\\bdisable ${NAME}\\b`).test(t)) return { enabled: false }
  if (/\b(?:keep|run) (?:the |your |my )?tools? (?:local|on (?:this|my) pc)\b|\bno (?:cloud|gpt|openai) tools\b/.test(t)) return { tools: false }
  if (new RegExp(`\\b(?:give|let) ${NAME} (?:use )?(?:the |your )?tools\\b|\\b${NAME} tools on\\b`).test(t)) return { enabled: true, tools: true }
  if (new RegExp(`\\buse ${NAME} for (?:the )?(?:hard|harder|difficult|big|complex)\\b`).test(t)) return { enabled: true, auto: true }
  if (new RegExp(`\\bonly (?:use|ask) ${NAME} when i (?:ask|say)\\b|\\b${NAME} only when i ask\\b`).test(t)) return { auto: false }
  if (new RegExp(`\\bturn (?:on ${NAME}|${NAME} on)\\b|\\b${NAME} on\\b|\\benable ${NAME}\\b|\\bstart using ${NAME}\\b`).test(t)) return { enabled: true }
  return null
}

// Did the owner ask for GPT/OpenAI by name? Returns { question } or null. Pure: no network, no files.
// It is the caller's job to check the setting; while it is off the turn is answered locally.
export function openAIDecision(text, { hasImages = false, hasAttachment = false } = {}) {
  const raw = String(text ?? '').trim()
  if (!raw || hasImages || hasAttachment) return null
  const head = raw.match(ASK)
  if (head && raw.length - head[0].length >= 3) return { question: raw.slice(head[0].length).trim() }
  const tail = raw.match(ASK_TAIL)
  if (tail && tail.index >= 3) return { question: raw.slice(0, tail.index).trim() }
  return null
}

// Tiering like Claude Code picks a model per job (owner, 2026-11-17: "however Claude Code and Claude does it"):
// everyday talk stays local, a hard question goes to GPT (cheap), and the heaviest thinking goes to Claude Opus.
// Heavy = long requests or deep design/proof/strategy/writing work. Pure: no network, no files.
const HEAVY = /\b(?:architect(?:ure)?|design (?:a|an|the|my)|system design|strategy|roadmap|business plan|prove|proof|derive|refactor|debug|root cause|threat model|critique|evaluate|essay|article|research|step[- ]by[- ]step|in depth|deep dive|thorough(?:ly)?)\b/i
export function heavyTurn(text) {
  const raw = String(text ?? '').trim()
  return raw.split(/\s+/).length >= 60 || HEAVY.test(raw)
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
        if (payload && payload !== '[DONE]') yield JSON.parse(payload)
      }
    }
  } finally { reader.releaseLock() }
}

export function recordOpenAIUsage(root, model, usage, now = Date.now()) {
  if (!root || !(usage?.prompt_tokens || usage?.completion_tokens)) return 0
  const usd = openAICostUsd(model, usage)
  try { mkdirSync(join(root, 'learning'), { recursive: true }); appendFileSync(usageFile(root), `${JSON.stringify({ day: dayOf(now), at: new Date(now).toISOString(), model, input: usage.prompt_tokens ?? 0, output: usage.completion_tokens ?? 0, usd: Number(usd.toFixed(6)) })}\n`, 'utf8') } catch {}
  return usd
}

// Streams one answer. Yields { text } pieces, then one { done, answer, usd, model, stop }.
// Throws Error with .code: OPENAI_OFF, OPENAI_NOT_CONFIGURED, OPENAI_DAILY_CAP, OPENAI_HTTP_<status>, OPENAI_REFUSED.
export async function* askOpenAI({ question, turns = [], root, environment = process.env, fetchImpl = fetch, signal, now = Date.now(), maxTokens = MAX_OUTPUT_TOKENS }) {
  const fail = (code, message) => Object.assign(new Error(message), { code })
  // Fail closed: without a settings root that says enabled, nothing is sent.
  const settings = root ? readOpenAISettings(root) : { ...DEFAULTS }
  if (!settings.enabled) throw fail('OPENAI_OFF', 'The OpenAI route is off, so Nori stays local.')
  const key = String(environment.OPENAI_API_KEY || '').trim()
  if (!key) throw fail('OPENAI_NOT_CONFIGURED', 'No OpenAI API key (OPENAI_API_KEY) reaches Nori on this PC.')
  const spent = openAISpentToday(root, now)
  if (spent >= settings.dailyUsd) throw fail('OPENAI_DAILY_CAP', `Today's OpenAI limit of $${settings.dailyUsd.toFixed(2)} is used up ($${spent.toFixed(2)} spent).`)
  const model = settings.model
  const response = await fetchImpl(OPENAI_ENDPOINT, {
    method: 'POST', signal, redirect: 'error',
    headers: { accept: 'text/event-stream', 'content-type': 'application/json', authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model, stream: true, stream_options: { include_usage: true }, max_completion_tokens: maxTokens,
      messages: [
        { role: 'system', content: `${NORI_PERSONA}\n\nThis one turn is answered through the OpenAI API because the owner asked for GPT by name. You have no tools here and cannot see this PC, its files, the screen or Nori's saved memories: if the answer needs any of those, say so plainly instead of guessing. Answer the newest message directly. Be concise: lead with the answer, keep it to a few sentences or a short list, no preamble and no recap. Go longer only when the owner asks for depth or the task is a piece of writing or code.` },
        ...history(turns, question),
      ],
    }),
  })
  if (!response.ok || !response.body) {
    const detail = await response.text().catch(() => '')
    let message = detail.slice(0, 300)
    try { message = JSON.parse(detail).error?.message?.slice(0, 300) || message } catch {}
    // OpenAI echoes part of a bad key in its 401 text: never pass that on.
    message = message.replace(/sk-[A-Za-z0-9_*-]{4,}/g, '[key]')
    throw fail(`OPENAI_HTTP_${response.status}`, message || `OpenAI API answered ${response.status}.`)
  }
  let answer = '', stop = null, refusal = ''
  let usage = {}
  try {
    for await (const event of sse(response, signal)) {
      if (event.error) throw fail('OPENAI_STREAM', String(event.error?.message || 'OpenAI API stream error').slice(0, 300))
      if (event.usage) usage = event.usage
      const choice = event.choices?.[0]
      if (!choice) continue
      if (choice.finish_reason) stop = choice.finish_reason
      if (choice.delta?.refusal) refusal += choice.delta.refusal
      if (choice.delta?.content) { answer += choice.delta.content; yield { text: choice.delta.content } }
    }
  } finally {
    // Whatever was generated is billed, also when the owner stops the reply: record it either way.
    if (usage.prompt_tokens || usage.completion_tokens) {
      try { mkdirSync(join(root, 'learning'), { recursive: true }); appendFileSync(usageFile(root), `${JSON.stringify({ day: dayOf(now), at: new Date(now).toISOString(), model, input: usage.prompt_tokens ?? 0, output: usage.completion_tokens ?? 0, usd: Number(openAICostUsd(model, usage).toFixed(6)) })}\n`, 'utf8') } catch {}
    }
  }
  if (!answer && (refusal || stop === 'content_filter')) throw fail('OPENAI_REFUSED', 'OpenAI declined this request.')
  yield { done: true, answer, usd: openAICostUsd(model, usage), model, stop }
}

export function openAIStatusLine(root, environment = process.env, now = Date.now()) {
  const settings = readOpenAISettings(root)
  const key = Boolean(String(environment.OPENAI_API_KEY || '').trim())
  return `OpenAI is ${settings.enabled ? 'on' : 'off'}${settings.enabled ? '' : ', so I stay fully local and free'}. ${key ? 'An OpenAI API key reaches me.' : 'No OpenAI API key reaches me.'} ${settings.enabled ? (settings.auto ? 'I send hard questions to GPT on my own, plus anything you ask GPT for by name' : 'I use it only when you ask for GPT by name') : 'When it is on, I send hard questions to GPT on my own, plus anything you ask GPT for by name'}, and each answer costs API money. ${settings.enabled && settings.tools ? 'GPT also drives my tools (they run here; what they read goes to OpenAI); say "keep tools local" to stop that.' : 'My tools run with my local model only.'} Model: ${settings.model}. Spent today: $${openAISpentToday(root, now).toFixed(2)} of a $${settings.dailyUsd.toFixed(2)} daily limit. Only the conversation text goes out, never my memories, your files or the screen. Say "turn ${settings.enabled ? 'off' : 'on'} OpenAI" to switch it.`
}
