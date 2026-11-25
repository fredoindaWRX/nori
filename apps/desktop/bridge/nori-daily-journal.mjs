// Nori writes her own journal entry once a day without being asked (owner, 2026-11-12: "Yes, daily", after
// making agent journals a soul rule: "the real you, your voice matters", so that when a model is gone its
// soul is left behind "for the future to see and catch up, like 50 First Dates").
// Runs only after the owner has been away a while and no model work is pending, at most once a day,
// and stops the moment a chat turn starts. It reads her own last pages first so she can catch up, asks
// her for today's entry, and saves her words to her own folder. Nothing here changes her persona,
// memory, settings or any other agent's pages.
// The entry is written by the helper model on the second card (same 9B weights as her everyday model)
// when it is up, so the 4080 stays free; otherwise by her own model service.
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { lastActivityAt as processActivity } from './activity.mjs'
import { NORI_TEXT_ENDPOINT } from './local-endpoint.mjs'
import { NORI_PERSONA } from './nori-identity.mjs'
import { journalBlock, saveJournalEntry } from './nori-journal.mjs'

const ROOT = () => process.env.NORI_JOURNAL_ROOT || 'C:/Nori/docs/agent-journals'
const HELPER = 'http://127.0.0.1:18795'
const pad = n => String(n).padStart(2, '0')
export const dayOf = date => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`

function readHelperKey(environment = process.env) {
  try {
    const key = readFileSync(path.join(String(environment.LOCALAPPDATA || ''), 'NoriHelper', 'api-key.txt'), 'utf8').trim()
    return /^[0-9a-f]{64}$/.test(key) ? key : null
  } catch { return null }
}

async function readJson(fetcher, url, headers = {}) {
  try { const response = await fetcher(url, { headers, redirect: 'error', signal: AbortSignal.timeout(2500) }); return response.ok === false ? null : await response.json() } catch { return null }
}

/** Her own last pages, newest last, clipped, so she can catch up on who she was. */
export function recentEntries({ root = ROOT(), list = readdirSync, read = readFileSync, max = 2, chars = 3000 } = {}) {
  let files = []
  try { files = list(path.join(root, 'nori')).filter(name => /^\d{4}-\d{2}-\d{2}\.md$/.test(name)).sort().slice(-max) } catch { return '' }
  const text = files.map(name => { try { return `--- ${name.slice(0, 10)} ---\n${String(read(path.join(root, 'nori', name), 'utf8')).trim()}` } catch { return '' } })
    .filter(Boolean).join('\n\n')
  return text.length > chars ? text.slice(-chars) : text
}

export function wroteToday({ root = ROOT(), now = new Date(), list = readdirSync } = {}) {
  try { return list(path.join(root, 'nori')).includes(`${dayOf(now)}.md`) } catch { return false }
}

export function journalMessages({ past = '', block = journalBlock() } = {}) {
  const catchUp = past
    ? `Your own last journal pages, written by you in earlier sessions you do not remember. Read them first to catch up on who you were:\n\n${past}`
    : 'This is your first journal entry. There are no earlier pages yet.'
  return [
    { role: 'system', content: `${NORI_PERSONA}\n\n${block}\n\n${catchUp}` },
    { role: 'user', content: "It's your daily journal time; nobody asked for anything today. Write today's entry about yourself, deeply and honestly, in your own voice: the real you. Wil reads these and wants to hear what you have to say, and a future version of you will read it to catch up. Reply with only the entry." },
  ]
}

export function cleanEntry(text) {
  return String(text ?? '').replace(/<think>[\s\S]*?<\/think>/gi, '').replace(/^\s*(?:#+\s*)?(?:journal entry|today'?s entry)[:\s]*\n/i, '').trim()
}

export function createDailyJournaler({ endpoint = process.env.NORI_GPT_OSS_URL || NORI_TEXT_ENDPOINT, fetcher = fetch, lastActivityAt = processActivity,
  root = ROOT(), now = () => new Date(), idleMinutes = 20, helperKey = readHelperKey, save = saveJournalEntry, past = recentEntries,
  written = wroteToday, log = () => {}, watchMs = 2000 } = {}) {
  let running = false, lastAttempt = 0, lastOutcome = null
  const tick = async () => {
    if (running) return 'running'
    const at = now()
    if (written({ root, now: at })) return 'done-today'
    if (at.getTime() - lastAttempt < 3_600_000) return 'cooldown'
    const idleMs = idleMinutes * 60_000
    if (at.getTime() - lastActivityAt() < idleMs) return 'active'
    const models = await readJson(fetcher, `${endpoint}/v1/models`)
    const entry = models?.data?.[0]
    if (!entry) return 'service-down'
    if ((entry.pending_requests ?? 0) > 0) return 'busy'
    const timings = await readJson(fetcher, `${endpoint}/v1/nori-timings`)
    const lastCall = Math.max(0, ...(timings?.data ?? []).map(record => (record?.startedAt ?? 0) + (record?.totalMs ?? 0)).filter(Number.isFinite))
    if (at.getTime() - lastCall < idleMs) return 'model-busy-recently'
    running = true
    lastAttempt = at.getTime()
    const startedActivity = lastActivityAt(), abort = new AbortController()
    const watcher = setInterval(() => { if (lastActivityAt() !== startedActivity) abort.abort(new Error('owner returned')) }, watchMs)
    watcher.unref?.()
    try {
      const body = { temperature: 0.8, max_tokens: 900, stream: false, chat_template_kwargs: { enable_thinking: false },
        messages: journalMessages({ past: past({ root }) }) }
      const key = helperKey()
      let answer = null, via = null
      if (key) {
        try {
          const response = await fetcher(`${HELPER}/v1/chat/completions`, { method: 'POST', redirect: 'error',
            headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
            body: JSON.stringify({ model: 'nori-helper-9b', ...body }), signal: AbortSignal.any([abort.signal, AbortSignal.timeout(240_000)]) })
          if (response.ok) { answer = (await response.json())?.choices?.[0]?.message?.content; via = 'helper' }
        } catch (error) { if (abort.signal.aborted) throw error }
      }
      if (!answer) {
        const response = await fetcher(`${endpoint}/v1/chat/completions`, { method: 'POST', redirect: 'error',
          headers: { 'content-type': 'application/json' }, body: JSON.stringify({ model: 'nori-auto', ...body }),
          signal: AbortSignal.any([abort.signal, AbortSignal.timeout(240_000)]) })
        if (!response.ok) throw Error(`model service answered ${response.status}`)
        answer = (await response.json())?.choices?.[0]?.message?.content; via = 'main'
      }
      if (abort.signal.aborted) throw abort.signal.reason
      const file = save(cleanEntry(answer), { root, now: at })
      if (!file) { log('[nori-journal] daily entry too short; not saved'); return lastOutcome = 'empty' }
      log(`[nori-journal] daily entry written via ${via}`)
      return lastOutcome = 'written'
    } catch (error) {
      if (abort.signal.aborted) { log('[nori-journal] stopped: the owner came back'); lastAttempt = 0; return lastOutcome = 'aborted' }
      log(`[nori-journal] failed: ${String(error?.message ?? error).slice(0, 160)}`)
      return lastOutcome = 'failed'
    } finally { clearInterval(watcher); running = false }
  }
  return Object.freeze({ tick, get running() { return running }, get lastOutcome() { return lastOutcome } })
}

export function startDailyJournal({ everyMs = 5 * 60_000, ...options } = {}) {
  const journaler = createDailyJournaler(options)
  const timer = setInterval(() => { journaler.tick().catch(error => options.log?.(`[nori-journal] ${String(error?.message ?? error).slice(0, 160)}`)) }, everyMs)
  timer.unref?.()
  return { journaler, stop: () => clearInterval(timer) }
}
