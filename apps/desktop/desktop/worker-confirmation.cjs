async function readReceipt(response) {
  const reader = response.body?.getReader()
  if (!reader) throw new Error('Missing Core receipt. Check Activity before retrying.')
  let size = 0
  const chunks = []
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > 65536) throw new Error('Oversized Core receipt. Check Activity before retrying.')
      chunks.push(Buffer.from(value))
    }
    const result = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    if (!result || typeof result !== 'object' || Array.isArray(result)) throw new Error('Invalid Core receipt')
    return result
  } finally { await reader.cancel().catch(() => {}) }
}

function validFiles(files) {
  return Array.isArray(files) && files.length <= 24
    && files.every(file => typeof file === 'string' && file.length > 0 && file.length <= 2048 && !/[\x00-\x1f\x7f]/.test(file))
}

function createWorkerConfirmation({ owns, getCore, ask, fetcher = fetch }) {
  let busy = false
  return async (event, taskId) => {
    const activation = ['enable', 'disable'].includes(taskId)
    const enable = taskId === 'enable'
    if (!owns(event) || (!activation && !/^[a-f0-9]{32}$/.test(taskId)) || busy) throw new Error('Invalid or overlapping owner confirmation')
    const core = getCore()
    const key = core?.workerApprovalKey
    if (!key || !/^[a-f0-9]{64}$/.test(key)) throw new Error('Owned worker confirmation is unavailable')
    const base = new URL(core.environment.NORI_COUNCIL_URL)
    if (base.protocol !== 'http:' || base.hostname !== '127.0.0.1' || !base.port || base.username || base.password || base.pathname !== '/' || base.search || base.hash) throw new Error('Invalid owned Core endpoint')
    const headers = { authorization: `Bearer ${core.environment.NORI_API_TOKEN}`, origin: base.origin,
      'sec-fetch-site': 'same-origin', 'content-type': 'application/json' }
    busy = true
    try {
      if (activation) {
        const approved = await ask({ goal: enable ? 'Enable Nori’s coding helper (local Aider)?' : 'Disable Nori’s coding helper (local Aider)?', files: [], context: [],
          attempt: enable ? 'Activation only — every task still requires a separate confirmation' : 'Blocks future dispatch. Use Stop task in Activity to stop work already running.' })
        if (!approved) return { confirmed: false }
        if (!owns(event) || getCore() !== core) throw new Error('Nori session changed; activation cancelled')
        const response = await fetcher(`${base.origin}/work/worker/${taskId}`, { method: 'POST',
          headers: { ...headers, 'X-Nori-Worker-Approval': key }, body: '{}', signal: AbortSignal.timeout(15000) })
        const activation = await readReceipt(response)
        if (!response.ok || activation.enabled !== enable || activation.per_task_confirmation_required !== true) throw new Error('Coder permission change failed. Select a project and restart Nori first.')
        return { confirmed: true, completed: false }
      }
      const response = await fetcher(`${base.origin}/work/${taskId}`, { headers, signal: AbortSignal.timeout(15000) })
      const task = await readReceipt(response)
      if (!response.ok || task.task_id !== taskId || task.status !== 'awaiting_approval' ||
          typeof task.goal !== 'string' || task.goal.length > 12000 ||
          !/^[a-f0-9]{64}$/.test(task.review?.binding) || !validFiles(task.review.editable_files) ||
          !task.review.editable_files.length || !validFiles(task.review.context_files) ||
          !Number.isSafeInteger(task.review.attempt) || task.review.attempt < 1) {
        throw new Error('Task is no longer available for confirmation')
      }
      const approved = await ask({ goal: String(task.goal).slice(0, 12000),
        files: task.review.editable_files.map(String), context: task.review.context_files.map(String), attempt: task.review.attempt })
      if (!approved) return { confirmed: false }
      if (!owns(event) || getCore() !== core) throw new Error('Nori session changed; confirmation cancelled')
      const result = await fetcher(`${base.origin}/work/${taskId}/confirm`, { method: 'POST',
        headers: { ...headers, 'X-Nori-Worker-Approval': key }, body: JSON.stringify({ binding: task.review.binding }),
        signal: AbortSignal.timeout(15000) })
      if (!result.ok) throw new Error('Confirmation was not accepted. Refresh Activity before retrying.')
      const receipt = await readReceipt(result)
      if (receipt.task_id !== taskId || receipt.status !== 'queued' || receipt.review?.binding !== task.review.binding) {
        throw new Error('Confirmation receipt could not be verified. Check Activity before retrying.')
      }
      return { confirmed: true, completed: false }
    } finally { busy = false }
  }
}
module.exports = { createWorkerConfirmation, readReceipt }
