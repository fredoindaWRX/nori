import { runSelfTest, selfTestHistory } from './self-improvement.mjs'
import { lastActivityAt as processActivity } from './activity.mjs'
import { NORI_TEXT_ENDPOINT } from './local-endpoint.mjs'
import { readIdleSettings } from './idle-self-test-settings.mjs'
export { DEFAULTS, readIdleSettings, writeIdleSettings, idleSelfTestSetting } from './idle-self-test-settings.mjs'

// Nori tests herself when left alone (owner-approved 2026-11-07): the quick self-test runs
// through her own model service after the owner has been away for a while, at most once per
// model per day, never while a request is pending, and it aborts the moment a chat turn starts.
// Results go to the same self-test history the owner-run test uses, tagged trigger:'idle'.
// Nothing here changes code, models or settings other than the owner's on/off choice below.
async function readJson(fetcher, url) {
  try { const response = await fetcher(url, { signal: AbortSignal.timeout(2500) }); return response.ok === false ? null : await response.json() } catch { return null }
}

export function createIdleSelfTester({ dataRoot, endpoint = process.env.NORI_GPT_OSS_URL || NORI_TEXT_ENDPOINT, fetcher = fetch,
  lastActivityAt = processActivity, run = runSelfTest, history = selfTestHistory, settings = () => readIdleSettings(dataRoot),
  now = Date.now, log = () => {}, watchMs = 2000 } = {}) {
  if (typeof dataRoot !== 'string' || !dataRoot) throw new TypeError('Idle self-tests need a data folder')
  let running = false, lastOutcome = null
  const tick = async () => {
    if (running) return 'running'
    const current = settings()
    if (!current.enabled) return 'disabled'
    const idleMs = current.idleMinutes * 60_000, at = now()
    if (at - lastActivityAt() < idleMs) return 'active'
    const models = await readJson(fetcher, `${endpoint}/v1/models`)
    const entry = models?.data?.[0]
    if (!entry?.backend_profile) return 'service-down'
    if ((entry.pending_requests ?? 0) > 0) return 'busy'
    // Any model work (coding worker, voice, another client) within the idle window counts as activity.
    const timings = await readJson(fetcher, `${endpoint}/v1/nori-timings`)
    const lastCall = Math.max(0, ...(timings?.data ?? []).map(record => (record?.startedAt ?? 0) + (record?.totalMs ?? 0)).filter(Number.isFinite))
    if (at - lastCall < idleMs) return 'model-busy-recently'
    const all = history(dataRoot).filter(Boolean)
    const runs = all.filter(record => !record.full)
    // Once a day per model the hard suite runs instead of the quick one: it is the one that can still show progress.
    const hardDue = !all.some(record => record.suite === 'hard' && record.models?.includes(entry.backend_profile) && at - Date.parse(record.at) < 20 * 3_600_000)
    if (hardDue && all.some(record => record.suite === 'hard' && at - Date.parse(record.at) < 3_600_000)) return 'cooldown'
    if (runs.some(record => at - Date.parse(record.at) < 3_600_000)) return 'cooldown'
    if (!hardDue && runs.some(record => record.models?.includes(entry.backend_profile) && at - Date.parse(record.at) < current.everyHours * 3_600_000)) return 'fresh'
    running = true
    const startedActivity = lastActivityAt(), abort = new AbortController()
    const watcher = setInterval(() => { if (lastActivityAt() !== startedActivity) abort.abort(new Error('owner returned')) }, watchMs)
    watcher.unref?.()
    log(`[nori-selftest] idle ${Math.round((at - startedActivity) / 60_000)} min on ${entry.backend_profile}: running the ${hardDue ? 'hard' : 'quick'} self-test`)
    try {
      let summary = ''
      for await (const piece of run({ full: false, suite: hardDue ? 'hard' : 'standard', dataRoot, endpoint, fetcher, signal: abort.signal, trigger: 'idle' })) summary = piece
      log(`[nori-selftest] ${summary.trim().split('\n')[0]}`)
      return lastOutcome = 'ran'
    } catch (error) {
      if (abort.signal.aborted) { log('[nori-selftest] stopped: the owner came back'); return lastOutcome = 'aborted' }
      log(`[nori-selftest] failed: ${String(error?.message ?? error).slice(0, 160)}`)
      return lastOutcome = 'failed'
    } finally { clearInterval(watcher); running = false }
  }
  return Object.freeze({ tick, get running() { return running }, get lastOutcome() { return lastOutcome } })
}

export function startIdleSelfTests({ everyMs = 5 * 60_000, ...options } = {}) {
  const tester = createIdleSelfTester(options)
  const timer = setInterval(() => { tester.tick().catch(error => options.log?.(`[nori-selftest] ${String(error?.message ?? error).slice(0, 160)}`)) }, everyMs)
  timer.unref?.()
  return { tester, stop: () => clearInterval(timer) }
}
