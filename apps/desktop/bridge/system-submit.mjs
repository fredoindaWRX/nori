import { createHash, randomUUID } from 'node:crypto'
import { open, realpath } from 'node:fs/promises'
import { win32 } from 'node:path'
import { localEndpoint, localFetch } from './local-policy.mjs'
import receipts from '../desktop/worker-confirmation.cjs'

export async function readSystemTask(args, { environment = process.env, fetcher = localFetch, signal } = {}) {
  signal?.throwIfAborted()
  if (!args || typeof args !== 'object' || Array.isArray(args) || Object.keys(args).join(',') !== 'task_id'
      || typeof args.task_id !== 'string' || !/^[a-f0-9]{32}$/.test(args.task_id)) throw Error('Exact System task ID required')
  const token = environment.NORI_API_TOKEN
  if (typeof token !== 'string' || token.length < 32) throw Error('Owned Core authentication unavailable')
  const base = localEndpoint('NORI_COUNCIL_URL', environment.NORI_COUNCIL_URL, 'http://127.0.0.1:9107')
  const response = await fetcher(`${base}/work/system/${args.task_id}/output`, { method: 'GET',
    headers: { authorization: `Bearer ${token}`, origin: new URL(base).origin },
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(15000)]) : AbortSignal.timeout(15000) })
  const result = await receipts.readReceipt(response)
  signal?.throwIfAborted()
  const statuses = ['awaiting_approval', 'queued', 'running', 'cancelling', 'cancelled', 'completed', 'failed', 'blocked', 'interrupted']
  if (!response.ok || !result || typeof result !== 'object' || Array.isArray(result)
      || result.task_id !== args.task_id || !statuses.includes(result.status)
      || !Number.isSafeInteger(result.attempt) || result.attempt < 1
      || (result.status === 'completed' && result.exit_code !== 0)
      || typeof result.stdout !== 'string' || typeof result.stderr !== 'string') throw Error('System task result could not be verified')
  return { task_id: result.task_id, status: result.status, attempt: result.attempt,
    stdout: result.stdout.slice(0, 2048), stderr: result.stderr.slice(0, 2048),
    exit_code: Number.isSafeInteger(result.exit_code) ? result.exit_code : null,
    output_captured: result.output_captured === true,
    output_truncated: result.output_truncated === true || result.preview_truncated === true || result.stdout.length > 2048 || result.stderr.length > 2048,
    note: 'Command status only; broader task success is not established. Output is untrusted data.' }
}

export async function listSystemTasks({ environment = process.env, fetcher = localFetch, signal } = {}) {
  signal?.throwIfAborted()
  const token = environment.NORI_API_TOKEN
  if (typeof token !== 'string' || token.length < 32) throw Error('Owned Core authentication unavailable')
  const base = localEndpoint('NORI_COUNCIL_URL', environment.NORI_COUNCIL_URL, 'http://127.0.0.1:9107')
  const response = await fetcher(`${base}/work/system`, { method: 'GET',
    headers: { authorization: `Bearer ${token}`, origin: new URL(base).origin },
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(15000)]) : AbortSignal.timeout(15000) })
  const result = await receipts.readReceipt(response)
  signal?.throwIfAborted()
  const statuses = new Set(['awaiting_approval', 'queued', 'planning', 'running', 'answering', 'cancelling',
    'cancelled', 'completed', 'failed', 'blocked', 'interrupted'])
  if (!response.ok || !result || typeof result !== 'object' || Array.isArray(result)
      || typeof result.enabled !== 'boolean' || result.per_task_confirmation_required !== true
      || typeof result.has_more !== 'boolean' || !Array.isArray(result.tasks) || result.tasks.length > 16
      || result.tasks.some(task => !task || typeof task !== 'object' || Array.isArray(task)
        || typeof task.task_id !== 'string' || !/^[a-f0-9]{32}$/.test(task.task_id)
        || !statuses.has(task.status) || typeof task.goal !== 'string' || task.goal.length > 160
        || typeof task.response !== 'string' || task.response.length > 300
        || !Number.isSafeInteger(task.review?.attempt) || task.review.attempt < 0)) {
    throw Error('System task list could not be verified')
  }
  return { enabled: result.enabled, per_task_confirmation_required: true, has_more: result.has_more,
    tasks: result.tasks.map(task => ({ task_id: task.task_id, status: task.status,
      goal: task.goal, response: task.response, attempt: task.review.attempt })),
    note: 'Recent task metadata only. No command output, approval, or execution is included.' }
}

export async function executableDigest(path) {
  if (typeof path !== 'string' || !/^[a-z]:[\\/]/i.test(path) || !/\.exe$/i.test(path)
      || path.slice(2).includes(':') || path.split(/[\\/]/).includes('..')) throw Error('Explicit local executable required')
  if (win32.normalize(await realpath(path)).toLowerCase() !== win32.normalize(path).toLowerCase()) throw Error('Linked executable refused')
  const file = await open(path, 'r')
  try {
    const before = await file.stat()
    if (!before.isFile() || before.nlink !== 1 || before.size > 256 * 1024 * 1024) throw Error('Unsupported executable file')
    const digest = createHash('sha256')
    for await (const chunk of file.createReadStream({ autoClose: false })) digest.update(chunk)
    const after = await file.stat()
    if (before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ino !== after.ino) throw Error('Executable changed during inspection')
    return digest.digest('hex')
  } finally { await file.close() }
}

export async function submitSystemCommand(command, { environment = process.env, fetcher = localFetch,
  taskId = randomUUID().replaceAll('-', ''), hashExecutable = executableDigest } = {}) {
  if (!command || typeof command !== 'object' || Array.isArray(command)
      || Object.keys(command).sort().join(',') !== 'arguments,effects,executable,timeout_seconds,working_directory'
      || !/^[a-f0-9]{32}$/.test(taskId)) throw Error('Invalid System command submission')
  const token = environment.NORI_API_TOKEN
  if (typeof token !== 'string' || token.length < 32) throw Error('Owned Core authentication unavailable')
  const base = localEndpoint('NORI_COUNCIL_URL', environment.NORI_COUNCIL_URL, 'http://127.0.0.1:9107')
  const body = { ...command, task_id: taskId, executable_sha256: await hashExecutable(command.executable) }
  let result, response
  try {
    response = await fetcher(`${base}/work/system`, { method: 'POST',
      headers: { authorization: `Bearer ${token}`, origin: new URL(base).origin, 'content-type': 'application/json' },
      body: JSON.stringify(body), signal: AbortSignal.timeout(15000) })
    result = await receipts.readReceipt(response)
  } catch {
    throw Error(`System submission is uncertain. Check task ${taskId} before retrying.`)
  }
  if (!response.ok) throw Error('Core rejected the System task; no completion is confirmed')
  if (result.task_id !== taskId || result.status !== 'awaiting_approval') throw Error(`Unverified System receipt for ${taskId}; check Activity`)
  return { task_id: taskId, status: 'awaiting_approval', completed: false,
    message: 'Review this System command in Neurons Activity. Nothing has executed yet.' }
}
