// Cloud model drives her tool loop (owner, 2026-11-17: "however Claude Code and Claude does it" -> "Tool use +
// planning" -> "Yes, give them tools"). Her tools still run on this PC through the same Neuralese boundary,
// approvals and private-file rules; only the model that decides the next call changes. What the tools read goes to
// the provider, so this is on only while the OpenAI route is on and its `tools` setting is on (default on; "keep
// tools local" turns it off). Spend counts toward the same daily cap.
import { OPENAI_MODEL, openAISpentToday, readOpenAISettings, recordOpenAIUsage } from './openai-route.mjs'

export const OPENAI_BASE = 'https://api.openai.com'
const ENDPOINT = `${OPENAI_BASE}/v1/chat/completions`
// Her tool loop budgets context in bytes; 64K keeps a GPT tool turn's cost bounded (~$0.02 worst case on gpt-5-mini).
export const CLOUD_TOOL_CONTEXT = 65536
// Reasoning models spend part of max_completion_tokens thinking; a floor keeps a tool call from being cut off.
const MIN_COMPLETION_TOKENS = 4096

/**
 * The tool driver for this turn: { endpoint, modelId, fetcher, contextTokens, label } when GPT should drive her
 * tools, else null (stay local). Pure apart from reading the settings file and the spend log.
 */
export function cloudToolDriver({ root = process.env.NORI_APP_DATA_ROOT, environment = process.env, fetchImpl = fetch, now = Date.now } = {}) {
  if (!root) return null
  const settings = readOpenAISettings(root)
  const key = String(environment.OPENAI_API_KEY || '').trim()
  if (!settings.enabled || !settings.tools || !key) return null
  if (openAISpentToday(root, now()) >= settings.dailyUsd) return null
  const model = settings.model || OPENAI_MODEL
  const fetcher = async (url, init = {}) => {
    if (url !== ENDPOINT) throw new Error('Cloud tool request refused: only the OpenAI Chat Completions endpoint is allowed.')
    const spent = openAISpentToday(root, now())
    if (spent >= settings.dailyUsd) throw new Error(`Today's OpenAI limit of $${settings.dailyUsd.toFixed(2)} is used up; no request was sent.`)
    const body = JSON.parse(init.body)
    // Her loop speaks llama-server's dialect; translate the two fields OpenAI does not take.
    delete body.chat_template_kwargs
    const limit = Number(body.max_tokens) || 1024
    delete body.max_tokens
    Object.assign(body, { model, stream: true, stream_options: { include_usage: true },
      max_completion_tokens: Math.max(limit, MIN_COMPLETION_TOKENS) })
    const response = await fetchImpl(url, { method: 'POST', signal: init.signal, redirect: 'error',
      headers: { 'content-type': 'application/json', accept: 'text/event-stream', authorization: `Bearer ${key}` },
      body: JSON.stringify(body) })
    const text = await response.text()
    if (!response.ok) {
      let message = text.slice(0, 300)
      try { message = JSON.parse(text).error?.message?.slice(0, 300) || message } catch {}
      throw new Error(`OpenAI tool turn failed (${response.status}): ${message.replace(/sk-[A-Za-z0-9_*-]{4,}/g, '[key]')}`)
    }
    // Buffered (tool-turn prose is buffered anyway) so the usage chunk can be recorded against the cap.
    let usage = null
    for (const line of text.split(/\r?\n/)) {
      if (!line.startsWith('data:')) continue
      const payload = line.slice(5).trim()
      if (!payload || payload === '[DONE]') continue
      try { const event = JSON.parse(payload); if (event.usage) usage = event.usage } catch {}
    }
    recordOpenAIUsage(root, model, usage, now())
    return new Response(text, { status: 200, headers: { 'content-type': 'text/event-stream' } })
  }
  return { endpoint: OPENAI_BASE, modelId: model, fetcher, contextTokens: CLOUD_TOOL_CONTEXT, label: 'GPT' }
}

/**
 * Runs the cloud-driven stream; if it fails before any text was produced, runs the local one instead, so a cloud
 * outage or a used-up cap never costs the owner the turn. The first piece of cloud text is marked "(GPT) ".
 */
export async function* withLocalFallback(cloud, local, { label = 'GPT', signal, toolsRan = () => false } = {}) {
  let started = false
  try {
    for await (const piece of cloud()) {
      if (!started && typeof piece === 'string' && piece) { started = true; yield `(${label}) ${piece}`; continue }
      if (typeof piece === 'string' && piece) started = true
      yield piece
    }
  } catch (error) {
    // Once a tool ran, rerunning locally could repeat its action: report the failure instead.
    if (started || signal?.aborted || toolsRan()) throw error
    yield* local()
  }
}
