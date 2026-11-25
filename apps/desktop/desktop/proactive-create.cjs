const { readReceipt } = require('./worker-confirmation.cjs')
function createProactiveSchedule({ owns, getCore, ask, fetcher = fetch }) {
  let busy = false
  return async (event, proposal) => {
    if (!owns(event) || busy || !proposal || Object.keys(proposal).sort().join() !== 'goal,intervalSeconds,maxRuns'
        || typeof proposal.goal !== 'string' || !proposal.goal.trim() || proposal.goal.length > 4000
        || !Number.isInteger(proposal.intervalSeconds) || proposal.intervalSeconds < 60 || proposal.intervalSeconds > 2592000
        || !Number.isInteger(proposal.maxRuns) || proposal.maxRuns < 1 || proposal.maxRuns > 100) throw Error('Invalid or busy schedule request')
    const reviewed = Object.freeze({ goal: proposal.goal.trim(), intervalSeconds: proposal.intervalSeconds, maxRuns: proposal.maxRuns })
    const core = getCore()
    if (!core) throw Error('Owned Core unavailable')
    const base = new URL(core.environment.NORI_COUNCIL_URL)
    if (base.protocol !== 'http:' || base.hostname !== '127.0.0.1' || !base.port || base.pathname !== '/'
        || base.username || base.password || base.search || base.hash) throw Error('Invalid Core endpoint')
    const current = () => { if (!owns(event) || getCore() !== core) throw Error('Schedule owner session changed') }
    async function post(route, body) {
      const response = await fetcher(`${base.origin}/proactive/${route}`, { method: 'POST',
        headers: { authorization: `Bearer ${core.environment.NORI_API_TOKEN}`, origin: base.origin, 'content-type': 'application/json' },
        body: JSON.stringify(body), signal: AbortSignal.timeout(15000) })
      const receipt = await readReceipt(response)
      if (!response.ok && receipt.error === 'native_task_execution_unqualified') throw Error('This routine needs native task execution that is not qualified yet. No usable routine was confirmed.')
      if (!response.ok) throw Error('Core rejected schedule operation')
      return receipt
    }
    busy = true
    let grantId
    try {
      if (await ask(reviewed) !== true) return { created: false }
      current()
      const grant = await post('grants', { label: 'Desktop confirmed routine', max_fires: reviewed.maxRuns })
      if (!/^[a-f0-9]{32}$/.test(grant.grant_id)) throw Error('Invalid schedule grant receipt')
      grantId = grant.grant_id
      current()
      const routine = await post('routines', { goal: reviewed.goal, interval_seconds: reviewed.intervalSeconds, grant_id: grantId })
      current()
      if (!/^[a-f0-9]{32}$/.test(routine.routine_id) || routine.grant_id !== grantId) throw Error('Invalid routine receipt')
      return { created: true, id: routine.routine_id }
    } catch (error) {
      if (grantId) {
        try {
          const revoked = await post(`grants/${grantId}/revoke`, {})
          if (revoked.status !== 'revoked' || revoked.grant_id !== grantId) throw Error('Revocation not confirmed')
        }
        catch { throw Error('Schedule outcome uncertain and grant revocation failed. Review saved routines before retrying.') }
      }
      throw error
    } finally { busy = false }
  }
}
module.exports = { createProactiveSchedule }
