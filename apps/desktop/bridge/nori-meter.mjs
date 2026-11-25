import { execFile } from 'node:child_process'
import { appendFileSync, mkdirSync, readFileSync, renameSync, statSync } from 'node:fs'
import path from 'node:path'
import { lastActivityAt } from './activity.mjs'
import { NORI_TEXT_ENDPOINT } from './local-endpoint.mjs'
import { secondCardLine } from './hardware-facts.mjs'

// Self-sensing (owner idea 2026-11-10, docs/NORI-COMPARTMENTS.md): Nori reads what the graphics card
// draws and which state she is in, once a minute, so later changes are ranked by measurement and not
// by guess. Read-only: one fixed nvidia-smi query and her own local status page. The reading is for
// the whole card, so other programs (OBS, games) are included; the report says so.
const MAX_LOG_BYTES = 512 * 1024
const ACTIVE_WINDOW_MS = 20_000
const logPath = dataRoot => path.join(dataRoot, 'learning', 'power.jsonl')

export function requestsMeter(text) {
  const value = String(text ?? '').toLowerCase().replace(/[.,!?;:]+/g, ' ').replace(/\s+/g, ' ').trim()
  if (!value || value.length > 300) return false
  return /\bhow (?:much|many) (?:power|energy|electricity|watts?)\b.{0,40}\b(?:you|nori|your)\b/.test(value)
    || /\b(?:what(?:'s| is| are)) (?:your|you) (?:power|energy|wattage)\b|\bwhat are you drawing\b/.test(value)
    || /\b(?:your|nori'?s?) (?:power|energy) (?:draw|usage|use|meter|consumption)\b|\bpower meter\b/.test(value)
}

export function parseGpuSample(stdout) {
  const [watts, percent, used, total] = String(stdout ?? '').trim().split('\n')[0].split(',').map(part => Number(part.trim()))
  if (![watts, percent, used].every(Number.isFinite) || watts < 0 || watts > 2000) return null
  return { gpuW: Math.round(watts * 10) / 10, gpuPct: Math.round(percent), vramMiB: Math.round(used), vramTotalMiB: Number.isFinite(total) ? Math.round(total) : null }
}

export function sampleGpu({ run = execFile } = {}) {
  return new Promise(resolve => run('nvidia-smi', ['--query-gpu=power.draw,utilization.gpu,memory.used,memory.total', '--format=csv,noheader,nounits'],
    { windowsHide: true, timeout: 8000, encoding: 'utf8' }, (error, stdout) => resolve(error ? null : parseGpuSample(stdout))))
}

async function modelStatus(endpoint, fetcher) {
  try {
    const entry = (await (await fetcher(`${endpoint}/v1/models`, { signal: AbortSignal.timeout(2000) })).json())?.data?.[0]
    return { model: typeof entry?.backend_profile === 'string' ? entry.backend_profile.slice(0, 40) : null, pending: Number(entry?.pending_requests) || 0 }
  } catch { return { model: null, pending: 0 } }
}

/** rest = nothing asked of her recently and no model call in flight. */
export const stateOf = ({ pending, idleMs }) => (pending > 0 || idleMs < ACTIVE_WINDOW_MS ? 'active' : 'rest')

export async function meterSample({ endpoint = process.env.NORI_GPT_OSS_URL || NORI_TEXT_ENDPOINT, fetcher = fetch, now = Date.now, gpu = sampleGpu, activity = lastActivityAt } = {}) {
  const [reading, status] = await Promise.all([gpu(), modelStatus(endpoint, fetcher)])
  if (!reading) return null
  return { at: new Date(now()).toISOString(), ...reading, model: status.model, state: stateOf({ pending: status.pending, idleMs: now() - activity() }) }
}

export function appendSample(dataRoot, sample) {
  const file = logPath(dataRoot)
  mkdirSync(path.dirname(file), { recursive: true })
  try { if (statSync(file).size > MAX_LOG_BYTES) renameSync(file, `${file}.old`) } catch {}
  appendFileSync(file, `${JSON.stringify(sample)}\n`, 'utf8')
}

export function readSamples(dataRoot, sinceMs = 0) {
  const rows = []
  for (const file of [`${logPath(dataRoot)}.old`, logPath(dataRoot)]) {
    try {
      for (const line of readFileSync(file, 'utf8').split('\n')) {
        if (!line) continue
        try { const row = JSON.parse(line); if (Number.isFinite(row.gpuW) && Date.parse(row.at) >= sinceMs) rows.push(row) } catch {}
      }
    } catch {}
  }
  return rows
}

const median = values => { const sorted = [...values].sort((a, b) => a - b); return sorted.length ? sorted[Math.floor(sorted.length / 2)] : null }

export function summarize(rows) {
  const out = {}
  for (const state of ['rest', 'active']) {
    const watts = rows.filter(row => row.state === state).map(row => row.gpuW)
    out[state] = { samples: watts.length, medianW: median(watts) }
  }
  return out
}

export function startMeter({ dataRoot, everyMs = 60_000, log = () => {}, sample = meterSample } = {}) {
  if (typeof dataRoot !== 'string' || !dataRoot) throw new TypeError('The meter needs a data folder')
  let failures = 0
  const tick = async () => {
    const reading = await sample()
    if (reading) { failures = 0; appendSample(dataRoot, reading) }
    else if (++failures === 3) log('[nori-meter] no graphics power reading; nvidia-smi did not answer')
  }
  const timer = setInterval(() => { tick().catch(error => log(`[nori-meter] ${String(error?.message ?? error).slice(0, 120)}`)) }, everyMs)
  timer.unref?.()
  log('[nori-meter] sampling graphics power once a minute')
  return { tick, stop: () => clearInterval(timer) }
}

/** Host-written answer to "how much power are you using"; every number is a reading. */
export async function meterReply({ dataRoot, now = Date.now, sample = meterSample, second = secondCardLine } = {}) {
  const live = await sample()
  if (!live) return 'I can\'t read the graphics card\'s power right now (nvidia-smi did not answer), so I have no number to give you.'
  const day = summarize(readSamples(dataRoot, now() - 24 * 3_600_000))
  const lines = [`Right now the graphics card is drawing **${live.gpuW} W** (${live.gpuPct}% busy, ${(live.vramMiB / 1024).toFixed(1)} GB of memory in use)${live.model ? `, with ${live.model} loaded` : ''}. I'm ${live.state === 'active' ? 'working on something' : 'at rest'}.`]
  const line = (label, entry) => entry.samples >= 5 ? `- ${label}: about **${Math.round(entry.medianW)} W** (${entry.samples} readings)` : `- ${label}: not enough readings yet (${entry.samples})`
  lines.push('', 'Over the last 24 hours:', line('At rest', day.rest), line('While working', day.active))
  if (day.rest.samples >= 5 && day.active.samples >= 5) lines.push('', `Working costs about ${Math.max(0, Math.round(day.active.medianW - day.rest.medianW))} W more than resting.`)
  lines.push('', 'This is the whole graphics card, so OBS, games and anything else using it are included. It is not the PC\'s total power: the processor, screen and the rest are not measured.')
  // The second card: what can be measured about it, stated separately because its power cannot be read.
  let other = ''
  try { other = await second() } catch {}
  if (other) lines.push('', other)
  return lines.join('\n')
}
