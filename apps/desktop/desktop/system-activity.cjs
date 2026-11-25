const { readReceipt } = require('./worker-confirmation.cjs')
function createSystemActivity({ owns, getCore, fetcher = fetch }) {
  return async (event, action = 'list', id) => {
    if (!owns(event) || !['list', 'cancel', 'output'].includes(action) || (action !== 'list' && !/^[a-f0-9]{32}$/.test(id))) throw Error('Invalid System activity request')
    const core = getCore()
    if (!core) throw Error('Owned Core unavailable')
    const base = new URL(core.environment.NORI_COUNCIL_URL)
    if (base.protocol !== 'http:' || base.hostname !== '127.0.0.1' || !base.port || base.pathname !== '/' || base.username || base.password || base.search || base.hash) throw Error('Invalid Core endpoint')
    const headers = { authorization: `Bearer ${core.environment.NORI_API_TOKEN}`, origin: base.origin, 'content-type': 'application/json' }
    const response = await fetcher(`${base.origin}/work/system${action === 'list' ? '' : `/${id}/${action}`}`, {
      headers, method: action === 'cancel' ? 'POST' : 'GET', body: action === 'cancel' ? '{}' : undefined, signal: AbortSignal.timeout(15000) })
    const result = await readReceipt(response)
    if (!response.ok || !owns(event) || getCore() !== core) throw Error('System activity unavailable or session changed')
    if (action === 'cancel') return { accepted: result.task_id === id, status: result.status }
    if (action === 'output') {
      if (result.task_id !== id || !Number.isSafeInteger(result.attempt) || result.attempt < 1 || typeof result.status !== 'string' || typeof result.stdout !== 'string' || typeof result.stderr !== 'string') throw Error('Invalid System output')
      return result
    }
    if (!Array.isArray(result.tasks)) throw Error('Invalid System activity')
    return { enabled: typeof result.enabled === 'boolean' ? result.enabled : null,
      perTaskConfirmationRequired: result.per_task_confirmation_required === true,
      // Keep the panel focused on work that still needs attention. Completed
      // receipts remain in Core's durable history and are available through
      // the read-only System task-list/read tools.
      hasMore: result.has_more === true, tasks: result.tasks.filter(task => task.status !== 'completed').map(task => ({ id: task.task_id, goal: task.goal, status: task.status,
      response: task.response || '', attempt: task.review?.attempt })) }
  }
}
function createMobileTaskActivity({ workActivity, getCore, fetcher = fetch }) {
  // This adapter forwards only chat-like owner guidance or cancellation for
  // existing work; it never forwards commands to System activation or approval.
  const owner = Object.freeze({})
  const system = createSystemActivity({ owns: event => event === owner, getCore, fetcher })
  return async (id = null, action = null, message = null) => {
    if (id !== null || action !== null) return message === null
      ? workActivity(id, action) : workActivity(id, action, message)
    const results = await Promise.allSettled([
      Promise.resolve().then(() => workActivity()),
      Promise.resolve().then(() => system(owner, 'list')),
    ])
    const sources = ['work', 'system']
    const unavailableSources = results.flatMap((result, index) =>
      result.status === 'rejected' || !Array.isArray(result.value?.tasks) ? [sources[index]] : [])
    if (unavailableSources.length === sources.length) throw Error('Task activity unavailable')
    const [work, commands] = results.map(result =>
      result.status === 'fulfilled' && Array.isArray(result.value?.tasks) ? result.value : { tasks: [] })
    const tasks = []
    for (let index = 0; index < 20; index++) {
      if (work.tasks[index]) tasks.push(work.tasks[index])
      if (commands.tasks[index]) tasks.push({ ...commands.tasks[index],
        goal: 'System Neuron: ' + commands.tasks[index].goal, canStop: false, events: [] })
    }
    return { tasks: tasks.slice(0, 20), unavailableSources }
  }
}
module.exports = { createSystemActivity, createMobileTaskActivity }
