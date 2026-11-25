import os from 'node:os'
import { execFile } from 'node:child_process'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { listLearnedMemory } from './nori-learning.mjs'
import { NORI_TEXT_ENDPOINT } from './local-endpoint.mjs'
import { NORI_RELEASE } from './release.mjs'
import { readIdleSettings } from './idle-self-test-settings.mjs'
import { readStreamModeSettings } from './stream-mode-settings.mjs'

// Her saved self-test runs (learning/self-tests.jsonl), read here directly: self-improvement.mjs
// imports this module, so importing its reader back would make a cycle.
function savedSelfTests(dataRoot) {
  try {
    if (!dataRoot) return []
    return readFileSync(join(dataRoot, 'learning', 'self-tests.jsonl'), 'utf8').trim().split('\n').map(line => { try { return JSON.parse(line) } catch { return null } }).filter(Boolean)
  } catch { return [] }
}

// Factual self-description for questions about Nori herself: what she runs on, why, how her
// machine is doing, and what has gone wrong lately. Every live line is measured when asked
// (model service, RAM, GPU, her own journal and state folder) so the model describes the real
// system instead of a fixed sheet. Read-only: nothing here changes models, files or settings.
const require = createRequire(import.meta.url)
const SELF = /\b(?:who|what) are you\b|\babout (?:yourself|you)\b|\byour (?:brain|mind|model|abilities|capabilities|limits|memory|feelings|consciousness|purpose|system|status|health|version|release)\b|\b(?:are you|do you (?:feel|think|have|learn|remember|evolve|grow))\b|\bwhat can you do\b|\bhow do you work\b|\bself[- ]aware/i
// Health questions: "why are you slow", "what's wrong with you", "how are you running", "are you ok".
const HEALTH = /\bwhy (?:are|were) you (?:so )?(?:slow|lagging|stuck|dumb|weird|broken)\b|\bwhat(?:'s| is) wrong with you\b|\bhow are you (?:running|doing on (?:ram|memory|vram|gpu))\b|\b(?:are|is) (?:you|nori) (?:ok|okay|healthy|working(?: right| properly)?)\b|\b(?:your|nori'?s?) (?:ram|vram|gpu|memory usage|errors?|problems?|uptime)\b|\bwhich (?:model|brain) are you (?:on|using)\b|\bdiagnose yourself\b|\bself[- ]check\b/i

export const asksAboutSelf = text => SELF.test(String(text ?? '')) || HEALTH.test(String(text ?? ''))

const TIERS = ['qwen3-14b', 'qwen3.5-9b']
const REASONS = Object.freeze({
  preferred: 'it is the first choice and it fit',
  preferred_after_owned_release: 'it is the first choice; it fit after the previous model was unloaded',
  preferred_capacity_unavailable: 'the first-choice 14B did not fit in free RAM/VRAM when it was loaded',
  preferred_capacity_unavailable_reuse_current: 'the first-choice model did not fit, so the already-loaded model was kept',
  preferred_capacity_changed: 'free memory dropped while switching, so a smaller model was loaded',
  preferred_startup_failed: 'the first-choice model failed to start, so a smaller model was loaded',
  stream_mode: 'OBS is running, so stream mode loaded the model that fits beside it on the shared GPU',
  stream_mode_capacity_unavailable: 'OBS is running (stream mode) and the 14B did not fit beside it, so the 9B was loaded',
})

function profiles() {
  try {
    const { importedModelProfile } = require('../desktop/imported-model-profile.cjs')
    return Object.fromEntries(TIERS.map(id => [id, importedModelProfile(id)]))
  } catch { return {} }
}

async function liveModel({ endpoint, fetcher }) {
  try {
    const response = await fetcher(`${endpoint}/v1/models`, { signal: AbortSignal.timeout(2500) })
    const entry = (await response.json())?.data?.[0]
    return entry?.backend_profile ? entry : null
  } catch { return null }
}

// One short measured line for every ordinary turn: which model is loaded and why. Without it a small model
// asked "how are you doing" invented a reason ("OBS is holding the 35B's memory" while OBS was closed, 2026-11-16).
// Empty when the model service does not answer, so nothing is guessed.
export async function modelFact({ environment = process.env, fetcher = fetch } = {}) {
  const model = await liveModel({ endpoint: environment.NORI_GPT_OSS_URL || NORI_TEXT_ENDPOINT, fetcher })
  if (!model) return ''
  const label = profiles()[model.backend_profile]?.label ?? model.backend_profile
  const reason = REASONS[model.routing_reason]
  return '[Nori model fact, measured by her app just now]\n'
    + `- Loaded model: ${label}. ${reason ? `Reason: ${reason}.` : 'The reason for this choice was not reported; say it is unknown if asked.'}`
    + ` OBS is ${model.stream_mode ? 'running (stream mode active)' : 'not running'}.`
    + ' Mention the model only if the owner asks or it matters to the answer, and never give a different reason than this one.'
}

export function queryGpu() {
  return new Promise(resolve => execFile('C:/Windows/System32/nvidia-smi.exe',
    ['--query-gpu=name,memory.total,memory.used,memory.free', '--format=csv,noheader,nounits'],
    { windowsHide: true, timeout: 3000, maxBuffer: 4096, encoding: 'utf8' },
    (error, stdout) => {
      if (error) return resolve(null)
      const [name, total, used, free] = String(stdout).trim().split('\n')[0].split(',').map(part => part.trim())
      const numbers = [total, used, free].map(Number)
      resolve(name && numbers.every(Number.isFinite) ? { name, totalMiB: numbers[0], usedMiB: numbers[1], freeMiB: numbers[2] } : null)
    }))
}

async function liveTimings({ endpoint, fetcher }) {
  try {
    const response = await fetcher(`${endpoint}/v1/nori-timings`, { signal: AbortSignal.timeout(2500) })
    const data = (await response.json())?.data
    return Array.isArray(data) ? data : null
  } catch { return null }
}

const median = values => { const sorted = values.filter(Number.isFinite).sort((a, b) => a - b); return sorted.length ? sorted[Math.floor(sorted.length / 2)] : undefined }
const sec = ms => `${(ms / 1000).toFixed(1)} s`

// Measured reply speed from the model service's own records (since it started) plus the saved
// log for the last 24 h, so "why are you slow" is answered with numbers, not guesses.
export function speedReport(records, savedRecords = [], now = Date.now()) {
  const lines = []
  const recent = (records ?? []).filter(record => record?.outcome === 'ok').slice(-10)
  if (recent.length) {
    const tps = median(recent.map(record => record.outputPerSecond)), first = median(recent.map(record => record.firstTokenMs))
    lines.push(`last ${recent.length} model calls: typical output ${tps === undefined ? 'unknown' : `${tps.toFixed(0)} tokens/s`}, first words after ${first === undefined ? 'unknown' : sec(first)}`)
  } else lines.push('no model calls measured since her model service started')
  const day = (savedRecords ?? []).filter(record => record && now - Date.parse(record.at) < 86_400_000)
  const bad = day.filter(record => record.outcome === 'timed-out' || record.outcome === 'failed')
  if (bad.length) lines.push(`${bad.length} model call(s) in the last 24 h ${[...new Set(bad.map(record => record.outcome))].join('/')}`)
  const slowest = day.filter(record => record.outcome === 'ok' && record.totalMs > 30_000).sort((a, b) => b.totalMs - a.totalMs)[0]
  if (slowest) {
    const parts = [`${sec(slowest.totalMs)} total`]
    if (slowest.routeMs > 2000) parts.push(`${sec(slowest.routeMs)} waiting for or loading a model`)
    if (Number.isFinite(slowest.promptTokens) && Number.isFinite(slowest.promptPerSecond)) parts.push(`${slowest.promptTokens} prompt tokens read at ${slowest.promptPerSecond.toFixed(0)}/s`)
    if (Number.isFinite(slowest.outputTokens) && Number.isFinite(slowest.outputPerSecond)) parts.push(`${slowest.outputTokens} tokens written at ${slowest.outputPerSecond.toFixed(1)}/s`)
    if (Number.isFinite(slowest.freeRamMiB)) parts.push(`${(slowest.freeRamMiB / 1024).toFixed(1)} GB RAM free then`)
    lines.push(`slowest call in the last 24 h (${ago(Date.parse(slowest.at), now)}, ${slowest.model ?? 'unknown model'}): ${parts.join(', ')}`)
  }
  return lines.join('; ')
}

function savedTimings(dataRoot) {
  try {
    const file = join(dataRoot, 'learning', 'model-timings.jsonl')
    if (!dataRoot || !existsSync(file)) return []
    return readFileSync(file, 'utf8').trim().split('\n').slice(-2000).map(line => { try { return JSON.parse(line) } catch { return null } }).filter(Boolean)
  } catch { return [] }
}

// Her latest self-test and whether it fell behind the previous run on the same model.
export function selfTestLine(dataRoot, now = Date.now(), { history = savedSelfTests, settings = readIdleSettings } = {}) {
  const idle = settings(dataRoot)
  const policy = idle.enabled
    ? `She also runs a quick self-test on her own after ${idle.idleMinutes} minutes without the owner, at most once per model every ${idle.everyHours} h; "stop testing yourself when I'm away" turns that off.`
    : 'Her own idle-time self-tests are turned off by the owner; "test yourself on your own again" turns them back on.'
  const runs = history(dataRoot).filter(record => record && Number.isFinite(Date.parse(record.at)))
  const latest = runs.at(-1)
  if (!latest) return `- Self-tests: none saved yet; "run a self-test" measures her answers by code. ${policy}`
  const pct = run => Math.round(run.pass / run.total * 100)
  const previous = runs.slice(0, -1).reverse().find(run => run.full === latest.full && run.models?.join() === latest.models?.join())
  const drop = previous ? pct(previous) - pct(latest) : 0
  return `- Self-tests: latest ${latest.pass}/${latest.total} (${pct(latest)}%) on ${latest.models?.join(' + ') || 'an unreported model'}, ${ago(Date.parse(latest.at), now)}, ${latest.trigger === 'idle' ? 'run on her own while idle' : 'run at the owner\'s request'}`
    + (previous ? (drop >= 8 ? `; that is ${drop} points below the previous run on the same model (${previous.pass}/${previous.total}, ${previous.release}), which points at a real regression` : `; in line with the previous run on the same model (${previous.pass}/${previous.total})`) : '')
    + `. ${policy}`
}

const gib = mib => (mib / 1024).toFixed(1)
const ago = (ms, now) => {
  const minutes = Math.max(0, Math.round((now - ms) / 60000))
  return minutes < 60 ? `${minutes} min ago` : minutes < 2880 ? `${Math.round(minutes / 60)} h ago` : `${Math.round(minutes / 1440)} days ago`
}

// Recent problems Nori can see in her own data folder: replies her journal marked failed or
// declined in the last day, and stale startup locks recovered in the last week.
export function recentProblems(dataRoot, now = Date.now()) {
  const problems = []
  if (!dataRoot) return problems
  try {
    const file = join(dataRoot, 'learning', 'experience.jsonl')
    if (existsSync(file)) {
      const day = readFileSync(file, 'utf8').trim().split('\n').slice(-500).map(line => { try { return JSON.parse(line) } catch { return null } })
        .filter(entry => entry && now - Date.parse(entry.at) < 86_400_000)
      const bad = day.filter(entry => entry.outcome === 'failed' || entry.outcome === 'declined')
      if (bad.length) {
        const kinds = [...new Set(bad.map(entry => entry.kind))].join(', ')
        problems.push(`${bad.length} of ${day.length} replies in the last 24 h ended failed or declined (${kinds}); the latest was ${ago(Date.parse(bad.at(-1).at), now)}`)
      }
    }
  } catch {}
  try {
    // The recovery time is in the name (.nori-state-owner.recovered-<ms>-pid<n>.json); a move keeps the old mtime.
    const recovered = readdirSync(dataRoot).map(name => /^\.nori-state-owner\.recovered-(\d{12,14})-/.exec(name))
      .filter(Boolean).map(match => Number(match[1])).filter(ms => now - ms < 7 * 86_400_000 && ms <= now)
    if (recovered.length) problems.push(`${recovered.length} stale startup lock(s) recovered in the last 7 days (left by an earlier abrupt shutdown)`)
  } catch {}
  return problems
}

export async function selfStatus({ environment = process.env, memory = listLearnedMemory, fetcher = fetch, gpu = queryGpu,
  freeRam = os.freemem, totalRam = os.totalmem, now = Date.now(), uptime = process.uptime } = {}) {
  const endpoint = environment.NORI_GPT_OSS_URL || NORI_TEXT_ENDPOINT
  const [model, card, timings] = await Promise.all([liveModel({ endpoint, fetcher }), gpu(), liveTimings({ endpoint, fetcher })])
  const speed = speedReport(timings, savedTimings(environment.NORI_APP_DATA_ROOT), now)
  const known = profiles()
  let counts = ''
  try {
    const entries = memory().entries ?? []
    const by = kind => entries.filter(entry => entry.bucket === kind || entry.kind === kind).length
    counts = `${entries.length} saved memories (${by('knowledge')} facts, ${by('preferences')} preferences, ${by('feedback')} corrections)`
  } catch { counts = 'saved memories (count unavailable)' }

  const active = model ? known[model.backend_profile] : null
  const label = active?.label ?? model?.backend_profile
  const brain = !model ? '- Brain right now: the local model service did not answer, so which model is loaded is unknown. Say so rather than guessing.'
    : `- Brain right now: ${label}, an open model imported and run locally on this PC, with a ${Math.round(model.context_tokens / 1024)}K-token working context`
      + `${active?.visionProjector ? ' and image understanding' : '; it cannot see images (image questions switch to a vision-capable model)'}.`
      + ` Loaded because ${REASONS[model.routing_reason] ?? 'of the automatic model choice (reason not reported)'}${Number.isFinite(model.routing_since) ? `, ${ago(model.routing_since, now)}` : ''}.`
      + ' Nori did not train it and conversations do not change its weights.'
      + (/abliterated/i.test(label ?? '') ? ' "Abliterated" means a community variant with the base model\'s built-in refusals removed.' : '')
  const tiers = TIERS.filter(id => known[id]).map(id => {
    const p = known[id]
    const needs = [p.minimumFreeVramMiB && `${gib(p.minimumFreeVramMiB)} GB free VRAM`, p.minimumFreeRamMiB && `${gib(p.minimumFreeRamMiB)} GB free RAM`].filter(Boolean).join(' + ')
    return `${p.label}${needs ? ` (needs ${needs})` : ''}`
  })
  const ramFree = freeRam() / 1024 ** 2, ramTotal = totalRam() / 1024 ** 2
  const machine = `- Machine now: ${gib(ramFree)} of ${gib(ramTotal)} GB RAM free`
    + (card ? `; ${card.name}: ${gib(card.freeMiB)} of ${gib(card.totalMiB)} GB VRAM free (her own loaded model counts as used)` : '; GPU memory could not be read')
    + `; ${os.cpus()[0]?.model?.trim() ?? 'unknown CPU'}; PC up ${Math.round(os.uptime() / 3600)} h, Nori's service up ${Math.round(uptime() / 60)} min.`
  const problems = recentProblems(environment.NORI_APP_DATA_ROOT, now)
  // Her own loaded model is most of the used memory; without this line a model reads low free
  // memory as a fault (it invented "thrashing" in a live test). The floors are measured sizes.
  const own = active ? `- Reading the memory numbers: the loaded ${label} itself holds about ${gib(active.minimumFreeVramMiB ?? 0)} GB of VRAM`
    + `${active.minimumFreeRamMiB ? ` and about ${gib(active.minimumFreeRamMiB)} GB of RAM` : ''} by design, so little free memory while it is loaded is normal and is not by itself a fault or a cause of slowness.`
    + ' Treat memory as a problem only when a recent-problem line or a failed model load says so; never claim swapping or thrashing that was not measured.' : ''

  return [
    // This exact header is how local-chat.mjs recognizes the block; keep it unchanged.
    '[Nori self-status: live facts about Nori, supplied by her own app. Use these instead of guessing about yourself.]',
    '- Measured just now. If a line says something is unknown, say it is unknown; do not fill it in.',
    `- Release: ${NORI_RELEASE.release} (${NORI_RELEASE.date}): ${NORI_RELEASE.summary}`,
    brain,
    `- Model order for text: ${tiers.join(' → ')}. She uses the first that fits in free memory and moves back up by herself when memory frees (it waits about 5 minutes after a failed fit). Images, and prompts too long for the 14B's 32K context, use the 9B. The choice is automatic: she cannot switch models on request. ${readStreamModeSettings(environment.NORI_APP_DATA_ROOT).enabled
      ? `Stream mode is on${model?.stream_mode ? ' and active right now (OBS is running)' : ' (not active now: OBS is not running)'}: while OBS runs she prefers the faster 24B because the shared GPU halves the 35B's speed, and goes back to the 35B when OBS closes; "turn off stream mode" disables it.`
      : 'Stream mode is turned off by the owner, so she keeps the 35B even while OBS runs; "turn on stream mode" re-enables it.'}`,
    `- Measured reply speed: ${speed}. For "why are you slow", use these numbers: a long wait means a model was loading or busy, a long first-word time with a big prompt means reading it, and low tokens/s with little free RAM points at memory pressure; if nothing here is slow, say the measured calls were not slow.`,
    machine,
    ...(own ? [own] : []),
    `- Recent problems: ${problems.length ? problems.join('; ') : 'none recorded in her journal in the last 24 h and no stale startup locks in the last 7 days'}. Her journal judges replies by their wording, so it can miss mistakes the owner noticed.`,
    selfTestLine(environment.NORI_APP_DATA_ROOT, now),
    '- Senses: hears the owner through local speech recognition when the microphone is on; speaks with a local voice when replies are read aloud; sees pasted images and a shared screen or camera only when the owner turns sharing on and a vision-capable model is loaded.',
    '- Tools she can choose herself: web lookups, operating websites in her own browser (with approval), making images, checking this PC\'s status, finding and reading the owner\'s own files (read-only), creating Word/PDF/Excel documents in Documents/Nori, and proposing commands that only run after approval.',
    `- Memory: ${counts} kept on this PC, recalled when relevant, plus this conversation.`,
    '- How she grows: through saved memories and corrections, skills the owner installs, and app updates the owner approves. She does not install changes to her own code by herself.',
    '- Cannot: act on social media or other online accounts, see the screen unless it is shared, run commands without approval, or keep working after a reply ends.',
    '- Inner life: there is no verified evidence that she has feelings or self-awareness. She can express a warm personality and describe her measured system state, but should be honest that this is not proven experience when asked directly.',
  ].join('\n')
}
