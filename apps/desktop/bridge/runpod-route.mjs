// RunPod route (owner, 2026-11-22: "can we tie a run pod to nori?", then "lego"). A rented GPU endpoint as her
// "big brain": a large open model on RunPod Serverless that only runs (and bills) while it answers. Opt-in and OFF
// by default: while it is off nothing here touches the network. It answers only when the owner asks for it by
// name ("ask runpod ...", "ask the big brain ..."); there is no automatic routing.
//
// What leaves the PC on such a turn: her persona text, the last 8 conversation turns (clipped) and the new message.
// Never memories, files, screen reads, images or attachments, and the model gets no tools.
// The key comes only from RUNPOD_API_KEY in the environment; it is never written to disk or into a log.
// The endpoint id is not a secret: RUNPOD_ENDPOINT_ID in the environment, or "endpointId" in the settings file.
//
// Cost: RunPod bills worker seconds, not tokens, so the daily cap counts the wall time of each request (cold start
// included) at "usdPerHour" from the settings. It is an estimate set high on purpose; the RunPod console is the bill.
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { NORI_PERSONA } from './nori-identity.mjs'

export const runPodEndpoint = id => `https://api.runpod.ai/v2/${id}/openai/v1/chat/completions`
const ENDPOINT_ID = /^[a-z0-9]{8,32}$/
const MODEL_NAME = /^[A-Za-z0-9][A-Za-z0-9._:\/-]{1,95}$/
const DEFAULTS = Object.freeze({ enabled: false, dailyUsd: 2, usdPerHour: 3, model: '', endpointId: '' })
const MAX_TURNS = 8, MAX_TURN_CHARS = 1500, MAX_OUTPUT_TOKENS = 4000
// A cold endpoint can take minutes to load a big model; after this the request is given up (and still counted).
export const RUNPOD_TIMEOUT_MS = 5 * 60_000

const NAME = '(?:run\\s?pod|(?:the |your )?big brain)'
const ASK = new RegExp(`^\\s*(?:hey\\s+)?(?:(?:ask|use|with|have|let)\\s+${NAME}(?:\\s+(?:to|for|about|answer))?|${NAME})\\s*[:,-]?\\s+`, 'i')
const ASK_TAIL = new RegExp(`[\\s,.;]+(?:(?:ask|use|with)\\s+${NAME}|${NAME}\\s+please)\\s*[.!?]*\\s*$`, 'i')

const settingsFile = root => join(root, 'learning', 'runpod-mode.json')
const usageFile = root => join(root, 'learning', 'runpod-usage.jsonl')
export function readRunPodSettings(root) {
  try {
    const raw = JSON.parse(readFileSync(settingsFile(root), 'utf8'))
    const daily = Number(raw.dailyUsd), rate = Number(raw.usdPerHour)
    return { enabled: raw.enabled === true,
      dailyUsd: Number.isFinite(daily) && daily >= 0 && daily <= 100 ? daily : DEFAULTS.dailyUsd,
      usdPerHour: Number.isFinite(rate) && rate > 0 && rate <= 100 ? rate : DEFAULTS.usdPerHour,
      model: MODEL_NAME.test(raw.model ?? '') ? raw.model : '',
      endpointId: ENDPOINT_ID.test(raw.endpointId ?? '') ? raw.endpointId : '' }
  } catch { return { ...DEFAULTS } }
}
export function writeRunPodSettings(root, next) {
  const value = { ...readRunPodSettings(root), ...next }
  mkdirSync(join(root, 'learning'), { recursive: true })
  writeFileSync(settingsFile(root), JSON.stringify(value), 'utf8')
  return value
}
const dayOf = now => new Date(now).toISOString().slice(0, 10)
export function runPodSpentToday(root, now = Date.now()) {
  try {
    const day = dayOf(now)
    return readFileSync(usageFile(root), 'utf8').split('\n').reduce((sum, line) => {
      if (!line.startsWith(`{"day":"${day}"`)) return sum
      try { const usd = Number(JSON.parse(line).usd); return sum + (Number.isFinite(usd) ? usd : 0) } catch { return sum }
    }, 0)
  } catch { return 0 }
}
const endpointOf = (settings, environment) => {
  const fromEnv = String(environment.RUNPOD_ENDPOINT_ID || '').trim()
  return ENDPOINT_ID.test(fromEnv) ? fromEnv : settings.endpointId
}

// "turn on runpod", "runpod off", "runpod status": a spoken or typed setting, answered locally.
export function runPodSetting(text) {
  const t = String(text ?? '').trim().toLowerCase()
  if (t.length > 90) return null
  if (new RegExp(`^(?:is ${NAME} (?:on|connected|working|set up)|${NAME} status|are you using ${NAME})\\b`).test(t)) return { status: true }
  if (new RegExp(`\\b(?:stop|don'?t|do not|never|quit) (?:using |use )${NAME}\\b|\\bturn (?:off ${NAME}|${NAME} off)\\b|\\b${NAME} off\\b|\\bdisable ${NAME}\\b`).test(t)) return { enabled: false }
  if (new RegExp(`\\bturn (?:on ${NAME}|${NAME} on)\\b|\\b${NAME} on\\b|\\benable ${NAME}\\b|\\bstart using ${NAME}\\b`).test(t)) return { enabled: true }
  return null
}

// Did the owner ask for RunPod / the big brain by name? Returns { question } or null. Pure: no network, no files.
export function runPodDecision(text, { hasImages = false, hasAttachment = false } = {}) {
  const raw = String(text ?? '').trim()
  if (!raw || hasImages || hasAttachment) return null
  const head = raw.match(ASK)
  if (head && raw.length - head[0].length >= 3) return { question: raw.slice(head[0].length).trim() }
  const tail = raw.match(ASK_TAIL)
  if (tail && tail.index >= 3) return { question: raw.slice(0, tail.index).trim() }
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
        if (payload && payload !== '[DONE]') yield JSON.parse(payload)
      }
    }
  } finally { reader.releaseLock() }
}

// Streams one answer. Yields { text } pieces, then one { done, answer, usd, model, seconds }.
// Throws Error with .code: RUNPOD_OFF, RUNPOD_NOT_CONFIGURED, RUNPOD_DAILY_CAP, RUNPOD_HTTP_<status>, RUNPOD_TIMEOUT.
export async function* askRunPod({ question, turns = [], root, environment = process.env, fetchImpl = fetch, signal, clock = Date.now, maxTokens = MAX_OUTPUT_TOKENS, timeoutMs = RUNPOD_TIMEOUT_MS }) {
  const fail = (code, message) => Object.assign(new Error(message), { code })
  // Fail closed: without a settings root that says enabled, nothing is sent.
  const settings = root ? readRunPodSettings(root) : { ...DEFAULTS }
  if (!settings.enabled) throw fail('RUNPOD_OFF', 'The RunPod route is off, so Nori stays local.')
  const key = String(environment.RUNPOD_API_KEY || '').trim()
  const endpointId = endpointOf(settings, environment)
  if (!key) throw fail('RUNPOD_NOT_CONFIGURED', 'No RunPod API key (RUNPOD_API_KEY) reaches Nori on this PC.')
  if (!endpointId) throw fail('RUNPOD_NOT_CONFIGURED', 'No RunPod endpoint id is set (RUNPOD_ENDPOINT_ID, or endpointId in learning/runpod-mode.json).')
  const started = clock()
  const spent = runPodSpentToday(root, started)
  if (spent >= settings.dailyUsd) throw fail('RUNPOD_DAILY_CAP', `Today's RunPod limit of $${settings.dailyUsd.toFixed(2)} is used up (about $${spent.toFixed(2)} spent).`)
  const timeout = AbortSignal.timeout(timeoutMs), both = signal ? AbortSignal.any([signal, timeout]) : timeout
  let answer = '', model = settings.model, sent = false
  try {
    sent = true
    const response = await fetchImpl(runPodEndpoint(endpointId), {
      method: 'POST', signal: both, redirect: 'error',
      headers: { accept: 'text/event-stream', 'content-type': 'application/json', authorization: `Bearer ${key}` },
      body: JSON.stringify({
        ...(settings.model ? { model: settings.model } : {}), stream: true, max_tokens: maxTokens,
        messages: [
          { role: 'system', content: `${NORI_PERSONA}\n\nThis one turn is answered by a larger open model on a rented RunPod endpoint because the owner asked for it by name. You have no tools here and cannot see this PC, its files, the screen or Nori's saved memories: if the answer needs any of those, say so plainly instead of guessing. Answer the newest message directly. Be concise: lead with the answer, no preamble and no recap. Go longer only when the owner asks for depth or the task is a piece of writing or code.` },
          ...history(turns, question),
        ],
      }),
    })
    if (!response.ok || !response.body) {
      const detail = await response.text().catch(() => '')
      let message = detail.slice(0, 300)
      try { const parsed = JSON.parse(detail); message = String(parsed.error?.message ?? parsed.error ?? message).slice(0, 300) } catch {}
      // Never pass a key on, whatever the service echoes.
      message = message.replaceAll(key, '[key]')
      throw fail(`RUNPOD_HTTP_${response.status}`, message || `RunPod answered ${response.status}.`)
    }
    for await (const event of sse(response, both)) {
      if (event.error) throw fail('RUNPOD_STREAM', String(event.error?.message || event.error || 'RunPod stream error').slice(0, 300))
      if (typeof event.model === 'string' && !model) model = event.model.slice(0, 96)
      const text = event.choices?.[0]?.delta?.content
      if (text) { answer += text; yield { text } }
    }
  } catch (error) {
    if (timeout.aborted && !signal?.aborted) throw fail('RUNPOD_TIMEOUT', `RunPod did not answer within ${Math.round(timeoutMs / 60000)} minutes (a cold endpoint can take a while to load its model).`)
    throw error
  } finally {
    // Worker time is billed whether or not the reply finished: count the wall time of every request that was sent.
    if (sent && root) {
      const seconds = Math.max(1, (clock() - started) / 1000), usd = seconds * settings.usdPerHour / 3600
      try { mkdirSync(join(root, 'learning'), { recursive: true }); appendFileSync(usageFile(root), `${JSON.stringify({ day: dayOf(started), at: new Date(started).toISOString(), model, seconds: Number(seconds.toFixed(1)), usd: Number(usd.toFixed(6)) })}\n`, 'utf8') } catch {}
    }
  }
  const seconds = Math.max(1, (clock() - started) / 1000)
  yield { done: true, answer, usd: seconds * settings.usdPerHour / 3600, model, seconds }
}

export function runPodStatusLine(root, environment = process.env, now = Date.now()) {
  const settings = readRunPodSettings(root)
  const key = Boolean(String(environment.RUNPOD_API_KEY || '').trim()), endpoint = Boolean(endpointOf(settings, environment))
  return `RunPod is ${settings.enabled ? 'on' : 'off'}${settings.enabled ? '' : ', so nothing goes there'}. ${key ? 'A RunPod API key reaches me.' : 'No RunPod API key reaches me.'} ${endpoint ? 'An endpoint id is set.' : 'No endpoint id is set.'} I use it only when you ask for RunPod or the big brain by name; it bills GPU seconds, cold start included. Spent today: about $${runPodSpentToday(root, now).toFixed(2)} of a $${settings.dailyUsd.toFixed(2)} daily limit (estimated at $${settings.usdPerHour.toFixed(2)} an hour). Only the conversation text goes out, never my memories, your files or the screen. Say "turn ${settings.enabled ? 'off' : 'on'} RunPod" to switch it.`
}
