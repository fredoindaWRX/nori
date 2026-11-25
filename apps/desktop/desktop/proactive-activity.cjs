const { readReceipt } = require('./worker-confirmation.cjs')
function createProactiveActivity({ owns, getCore, fetcher = fetch }) {
  return async (event, action = 'list', id) => {
    if (!owns(event) || !['list', 'disableRoutine', 'disableMonitor'].includes(action)
        || (action !== 'list' && !/^[a-f0-9]{32}$/.test(id))) throw Error('Invalid proactive request')
    const core = getCore()
    if (!core) throw Error('Owned Core unavailable')
    const base = new URL(core.environment.NORI_COUNCIL_URL)
    if (base.protocol !== 'http:' || base.hostname !== '127.0.0.1' || !base.port
        || base.pathname !== '/' || base.username || base.password || base.search || base.hash) throw Error('Invalid Core endpoint')
    const route = action === 'list' ? 'routines' : `${action === 'disableRoutine' ? 'routines' : 'monitors'}/${id}/disable`
    const response = await fetcher(`${base.origin}/proactive/${route}`, {
      method: action === 'list' ? 'GET' : 'POST', body: action === 'list' ? undefined : '{}',
      headers: { authorization: `Bearer ${core.environment.NORI_API_TOKEN}`, origin: base.origin, 'content-type': 'application/json' },
      signal: AbortSignal.timeout(15000) })
    const result = await readReceipt(response)
    if (!response.ok || !owns(event) || getCore() !== core) throw Error('Proactive activity unavailable or session changed')
    if (action !== 'list') {
      if (result.enabled !== false || (result.routine_id || result.monitor_id) !== id) throw Error('Disable was not confirmed')
      return { disabled: true }
    }
    if (result.schema !== 'nori.proactive-routines.v1' || !Array.isArray(result.routines) || !Array.isArray(result.monitors)
        || typeof result.runner_active !== 'boolean') throw Error('Invalid proactive status')
    const items = [...result.routines.map(row => ({ ...row, kind: 'routine', id: row.routine_id })),
      ...result.monitors.map(row => ({ ...row, kind: 'monitor', id: row.monitor_id }))]
    return { running: result.runner_active, error: typeof result.last_loop_error === 'string' ? result.last_loop_error.slice(0, 100) : null,
      hasMore: items.length > 64, items: items.slice(0, 64).map(row => {
        if (!/^[a-f0-9]{32}$/.test(row.id) || typeof row.goal !== 'string' || typeof row.enabled !== 'boolean') throw Error('Invalid proactive item')
        const history = row.kind === 'routine' ? result.recent_fires : result.recent_monitor_checks
        const latest = Array.isArray(history) ? history.slice(0, 50).find(item => item && (row.kind === 'routine' ? item.routine_id : item.monitor_id) === row.id) : null
        const time = latest && (row.kind === 'routine' ? latest.created_at : latest.checked_at)
        const lastRun = latest ? {
          status: String(row.kind === 'routine' ? latest.status : latest.outcome).slice(0, 100),
          taskId: typeof latest.task_id === 'string' && /^[A-Za-z0-9_-]{1,80}$/.test(latest.task_id) ? latest.task_id : null,
          error: typeof latest.error_type === 'string' ? latest.error_type.slice(0, 100) : null,
          at: typeof time === 'number' && Number.isFinite(time) && time >= 0 && time <= 8640000000000 ? time : null,
        } : null
        return { id: row.id, kind: row.kind, goal: row.goal.slice(0, 12000), enabled: row.enabled, status: String(row.last_status).slice(0, 100), lastRun }
      }) }
  }
}
module.exports = { createProactiveActivity }
