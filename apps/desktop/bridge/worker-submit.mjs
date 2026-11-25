import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'
import { localEndpoint, localFetch } from './local-policy.mjs'
import { codingOwnerBinding as checkedCodingBinding } from './coding-run-events.mjs'

export function backgroundAdmissionMessage(receipt) {
  if (!receipt || receipt.completed !== false || !/^[a-f0-9]{32}$/.test(receipt.task_id)
      || !['queued', 'awaiting_approval'].includes(receipt.status)) return null
  if (receipt.chat_first === true && receipt.status === 'queued') return 'Your coding request is queued. I’ll show its progress, actual changes and test result here in chat.'
  return receipt.status === 'awaiting_approval'
    ? `I prepared coding task ${receipt.task_id} for my coding helper. Review its editable files in the Activity panel and choose “Review and confirm.” No code changes are confirmed yet.`
    : `Coding task ${receipt.task_id} was accepted for my coding helper. Follow the Activity panel for progress; no code changes are confirmed yet.`
}

/** One tool session owns one admission attempt per exact scope, including timeout uncertainty. */
export function createBackgroundWorkerSubmission(bound, submit = submitBackgroundWorker) {
  const attempts = new Map()
  return (allowed, context) => {
    const key = JSON.stringify([allowed, context])
    if (!attempts.has(key)) {
      const scope = JSON.parse(key)
      attempts.set(key, Promise.resolve().then(() => submit({ ...bound, allowed: scope[0], context: scope[1] })))
    }
    return attempts.get(key)
  }
}

export async function submitBackgroundWorker({ goal, workspace, allowed, context, environment = process.env,
  fetcher = localFetch, signal, taskId = null, codingOwnerBinding = null, onCodingAdmission = null }) {
  const owner = codingOwnerBinding === null ? null : checkedCodingBinding(codingOwnerBinding)
  if (codingOwnerBinding !== null && (!owner || typeof onCodingAdmission !== 'function')) throw Error('Owned coding registration is invalid; no task submitted.')
  taskId = taskId ?? owner?.taskId ?? randomUUID().replaceAll('-', '')
  if (owner && taskId !== owner.taskId) throw Error('Coding task identity differs from the owner registration.')
  // A local mentor can retain this identity across an uncertain transport result.
  // Core binds the ID to the complete order and still owns every approval.
  if (typeof taskId !== 'string' || !/^[a-f0-9]{32}$/.test(taskId)) {
    throw new Error('Invalid background task identity.')
  }
  signal?.throwIfAborted()
  let cleanupPromise = null
  const cleanup = () => {
    if (!owner) return Promise.resolve(false)
    if (!cleanupPromise) cleanupPromise = Promise.resolve().then(() => onCodingAdmission(owner, {cleanupOnly:true}))
      .then(result => result?.authorized === false && result.taskId === taskId && result.cleanupConfirmed === true, () => false)
    return cleanupPromise
  }
  const base = localEndpoint('NORI_COUNCIL_URL', environment.NORI_COUNCIL_URL, 'http://127.0.0.1:9107')
  let token = environment.NORI_API_TOKEN?.trim()
  if (!token) {
    const path = environment.NORI_API_TOKEN_FILE || fileURLToPath(new URL('../../../nori/runtime-data/secrets/council-token', import.meta.url))
    try { token = readFileSync(path, 'utf8').trim() } catch { /* report unavailable below */ }
  }
  if (!token || token.length < 32) throw new Error('Background worker authentication is unavailable.')
  let response
  try { response = await fetcher(`${base}/work/worker`, {
    method: 'POST', signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(15000)]) : AbortSignal.timeout(15000),
    headers: { authorization: `Bearer ${token}`, origin: new URL(base).origin,
      'sec-fetch-site': 'same-origin', 'content-type': 'application/json' },
    body: JSON.stringify({ task_id: taskId, goal, workspace, allowed_files: allowed, context_files: context }),
  }) } catch {
    const cleaned = await cleanup()
    throw new Error(`Background submission could not be confirmed for task ${taskId}. ${cleaned ? 'The exact registered task was canceled.' : 'Cleanup is not confirmed; inspect this task before retrying.'}`)
  }
  let body
  try {
    const reader = response.body?.getReader()
    if (!reader) throw new Error('Missing receipt')
    const chunks = []
    let size = 0
    try {
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        size += value.byteLength
        if (size > 65536) throw new Error('Oversized receipt')
        chunks.push(Buffer.from(value))
      }
    } finally { await reader.cancel().catch(() => {}) }
    body = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    if (!body || typeof body !== 'object' || response.status >= 500) throw new Error('Uncertain receipt')
  } catch {
    const cleaned = await cleanup()
    throw new Error(`Background submission receipt could not be verified for task ${taskId}. ${cleaned ? 'The exact registered task was canceled.' : 'Cleanup is not confirmed; inspect this task before retrying.'}`)
  }
  if (!response.ok) { await cleanup(); throw new Error('Core did not accept the background coding task. No completion is confirmed.') }
  if (body.task_id !== taskId || !['queued', 'awaiting_approval'].includes(body.status)) { await cleanup(); throw new Error('Core returned an unverifiable task acceptance.') }
  if (owner) {
    if (signal?.aborted) { await cleanup(); throw signal.reason || Error('Coding request stopped after admission; no completion is confirmed.') }
    let admission
    try {
      admission = await onCodingAdmission(owner, {cleanupOnly:false})
      signal?.throwIfAborted()
      if (admission?.authorized !== true || admission.taskId !== taskId || admission.status !== 'queued') throw Error('The registered coding task was not authorized by its owned session. No completion is confirmed.')
    } catch (error) { await cleanup(); throw error }
    return JSON.stringify({status:'queued',task_id:taskId,completed:false,chat_first:true})
  }
  return JSON.stringify({ status: body.status, task_id: taskId, completed: false,
    message: 'Accepted for background coding. Approval and execution are checked by Core. Follow Activity for progress and results; do not claim files have changed yet.' })
}
