const { readReceipt } = require('./worker-confirmation.cjs')

function validateReview(task, taskId) {
  const review = task?.review
  const command = review?.command
  const text = (value, max) => typeof value === 'string' && value.length > 0 && value.length <= max && !/[\x00-\x1f\x7f]/.test(value)
  if (task?.task_id !== taskId || task.status !== 'awaiting_approval' || review?.kind !== 'system-command' ||
      !/^[a-f0-9]{64}$/.test(review.binding) || !Number.isSafeInteger(review.attempt) || review.attempt < 1 ||
      command?.task_id !== taskId || !text(command.executable, 2048) || !text(command.working_directory, 2048) ||
      !/^[a-f0-9]{64}$/.test(command.executable_sha256) ||
      !Array.isArray(command.arguments) || command.arguments.length > 64 || !command.arguments.every(arg => text(arg, 4096)) ||
      !Array.isArray(command.effects) || !command.effects.length || command.effects.length > 24 || !command.effects.every(effect => text(effect, 1000)) ||
      !Number.isSafeInteger(command.timeout_seconds) || command.timeout_seconds < 1 || command.timeout_seconds > 3600) {
    throw new Error('System task review is invalid or no longer pending')
  }
  return review
}

function createSystemConfirmation({ owns, getCore, ask, fetcher = fetch }) {
  let busy = false
  return async (event, taskId) => {
    const activation = taskId === 'enable' || taskId === 'disable'
    if (!owns(event) || busy || (!activation && !/^[a-f0-9]{32}$/.test(taskId))) throw Error('Invalid System confirmation')
    const core = getCore()
    const key = core?.systemApprovalKey
    if (!/^[a-f0-9]{64}$/.test(key || '')) throw Error('Owned System service unavailable')
    const base = new URL(core.environment.NORI_COUNCIL_URL)
    if (base.protocol !== 'http:' || base.hostname !== '127.0.0.1' || !base.port || base.username || base.password || base.pathname !== '/' || base.search || base.hash) throw Error('Invalid Core endpoint')
    const headers = { authorization: `Bearer ${core.environment.NORI_API_TOKEN}`, origin: base.origin,
      'sec-fetch-site': 'same-origin', 'content-type': 'application/json' }
    busy = true
    try {
      let review
      if (!activation) {
        const response = await fetcher(`${base.origin}/work/system/${taskId}`, { headers, signal: AbortSignal.timeout(15000) })
        const task = await readReceipt(response)
        if (!response.ok) throw Error('System task unavailable')
        review = validateReview(task, taskId)
      }
      if (!await ask(activation ? { activation: taskId } : { review })) return { confirmed: false }
      if (!owns(event) || getCore() !== core) throw Error('Nori session changed; System confirmation cancelled')
      const suffix = activation ? taskId : `${taskId}/confirm`
      const response = await fetcher(`${base.origin}/work/system/${suffix}`, { method: 'POST',
        headers: { ...headers, 'X-Nori-System-Approval': key },
        body: JSON.stringify(activation ? {} : { binding: review.binding }), signal: AbortSignal.timeout(15000) })
      const result = await readReceipt(response)
      if (!response.ok || (activation
        ? result.enabled !== (taskId === 'enable') || result.per_task_confirmation_required !== true
        : result.task_id !== taskId || result.status !== 'queued' || result.review?.binding !== review.binding)) {
        throw Error('System confirmation could not be verified; refresh Activity before retrying')
      }
      return { confirmed: true, completed: false }
    } finally { busy = false }
  }
}
module.exports = { createSystemConfirmation, validateReview }
