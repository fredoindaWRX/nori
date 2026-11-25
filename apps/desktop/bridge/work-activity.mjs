/** Owner-facing views of Core's durable tasks. Core remains the executor. */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { localEndpoint, localFetch } from './local-policy.mjs'

const ID = /^[a-f0-9]{32}$/
const STATES = new Set(['awaiting_approval', 'queued', 'planning', 'running', 'answering', 'cancelling', 'completed', 'failed', 'cancelled', 'interrupted', 'blocked'])
const TERMINAL = new Set(['completed', 'failed', 'cancelled', 'interrupted', 'blocked'])
const STEERABLE = new Set(['queued', 'planning', 'running', 'answering'])
const TOKEN_FILE = fileURLToPath(new URL('../../../nori/runtime-data/secrets/council-token', import.meta.url))
const text = (value, limit) => typeof value === 'string' ? value.slice(0, limit) : ''

export function projectWorkTask(value) {
  if (!value || typeof value.task_id !== 'string' || !ID.test(value.task_id) || !STATES.has(value.status)) throw new Error('invalid_task_state')
  const fixedTask = ['native_reviewed_read', 'native_research'].includes(value.response_route)
  return {
    id: value.task_id, goal: text(value.goal, 1200), status: value.status,
    createdAt: text(value.created_at, 64), updatedAt: text(value.updated_at, 64),
    response: text(value.response, 16000),
    review: value.review && /^[a-f0-9]{64}$/.test(value.review.binding) ? {
      binding: value.review.binding,
      attempt: Number.isSafeInteger(value.review.attempt) ? value.review.attempt : 0,
      editableFiles: Array.isArray(value.review.editable_files) ? value.review.editable_files.slice(0, 24).map(path => text(path, 2048)) : [],
      contextFiles: Array.isArray(value.review.context_files) ? value.review.context_files.slice(0, 24).map(path => text(path, 2048)) : [],
    } : null,
    canStop: !TERMINAL.has(value.status) && value.status !== 'cancelling',
    canResume: !fixedTask && TERMINAL.has(value.status) && value.status !== 'completed',
    canSteer: !fixedTask && STEERABLE.has(value.status) && !value.review,
    events: (Array.isArray(value.events) ? value.events : []).slice(-8)
      .filter(event => event && typeof event.message === 'string')
      .map(event => ({ message: text(event.message, 1500), at: text(event.timestamp, 64) })),
  }
}

export function createWorkActivityClient({ environment = process.env, fetcher = localFetch, timeoutMs = 12000 } = {}) {
  return async (taskId = null, action = null, message = null) => {
    if ((taskId !== null && (typeof taskId !== 'string' || !ID.test(taskId))) || (action !== null && (!taskId || !['cancel', 'resume', 'steer'].includes(action)))
      || (action === 'steer' && (typeof message !== 'string' || !message.trim() || message.length > 2000))) {
      throw new Error('invalid_activity_request')
    }
    const base = localEndpoint('NORI_COUNCIL_URL', environment.NORI_COUNCIL_URL, 'http://127.0.0.1:9107')
    let token = environment.NORI_API_TOKEN?.trim()
    if (!token) {
      try { token = readFileSync(environment.NORI_API_TOKEN_FILE || TOKEN_FILE, 'utf8').trim() } catch { /* unavailable */ }
    }
    if (!token || token.length < 32) throw new Error('work_service_unavailable')
    const path = taskId ? `/work/${taskId}${action ? `/${action}` : ''}` : '/work'
    const requestBody = action === 'steer' ? JSON.stringify({ message: message.trim() }) : action ? '{}' : undefined
    const response = await fetcher(`${base}${path}`, {
      method: action ? 'POST' : 'GET', signal: AbortSignal.timeout(timeoutMs),
      headers: { authorization: `Bearer ${token}`, origin: new URL(base).origin,
        'sec-fetch-site': 'same-origin', 'content-type': 'application/json' },
      ...(action ? { body: requestBody } : {}),
    })
    const reader = response.body?.getReader()
    if (!reader) throw new Error('invalid_task_state')
    let bytes = 0
    const chunks = []
    try {
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        bytes += value.byteLength
        if (bytes > 2 * 1024 * 1024) throw new Error('invalid_task_state')
        chunks.push(Buffer.from(value))
      }
    } finally { await reader.cancel().catch(() => {}) }
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    if (!response.ok) {
      const known = new Set(['native_task_execution_unqualified', 'sentinel_denied', 'task_not_found', 'invalid_work_request'])
      throw new Error(known.has(body.error) ? body.error : 'work_service_unavailable')
    }
    if (action === 'steer') {
      if (body.task_id !== taskId || body.accepted !== true || body.scope_unchanged !== true) throw new Error('invalid_task_state')
      return body
    }
    if (taskId) {
      const task = projectWorkTask(body)
      if (task.id !== taskId) throw new Error('invalid_task_state')
      return { tasks: [task] }
    }
    if (!Array.isArray(body.tasks) || body.tasks.length > 20) throw new Error('invalid_task_state')
    return { tasks: body.tasks.map(projectWorkTask) }
  }
}

const client = createWorkActivityClient()
const MESSAGES = {
  native_task_execution_unqualified: 'This task cannot resume yet: the local planner and executor have not passed qualification.',
  sentinel_denied: 'Nori Core denied this task action.',
  task_not_found: 'This saved task is no longer available.',
  invalid_work_request: 'Core did not accept this task action in its current state.',
  invalid_task_state: 'Nori could not verify the task status returned by Core.',
}

export async function handleWorkActivity(req, res, { originAllowed, allowWrites, cors = {}, request = client }) {
  if (!req.url?.startsWith('/work-activity')) return false
  const reply = (status, value) => {
    res.writeHead(status, { ...cors, 'content-type': 'application/json', 'cache-control': 'no-store' })
    res.end(JSON.stringify(value))
    return true
  }
  if (!req.headers.origin || !originAllowed(req.headers.origin)) return reply(403, { error: 'Open Activity from the local Nori interface.' })
  const match = /^\/work-activity(?:\/([a-f0-9]{32})\/(cancel|resume|steer))?$/.exec(req.url)
  if (!match) return reply(404, { error: 'Unknown task operation.' })
  const [, id, action] = match
  if (req.method !== (action ? 'POST' : 'GET')) return reply(405, { error: 'Unsupported task method.' })
  if (action === 'resume' && allowWrites !== true) return reply(403, { error: 'Enable write access before resuming work.' })
  let ownerMessage = null
  if (action) {
    if (req.headers['content-type']?.split(';')[0] !== 'application/json') return reply(400, { error: 'Expected an empty JSON object.' })
    let raw = ''
    for await (const chunk of req) {
      raw += chunk
      if (Buffer.byteLength(raw) > (action === 'steer' ? 8192 : 128)) return reply(413, { error: 'Task control request is too large.' })
    }
    try {
      const body = JSON.parse(raw)
      if (!body || Array.isArray(body) || typeof body !== 'object') throw new Error()
      if (action === 'steer') {
        if (Object.keys(body).length !== 1 || typeof body.message !== 'string' || !body.message.trim() || body.message.length > 2000) throw new Error()
        ownerMessage = body.message.trim()
      } else if (Object.keys(body).length) throw new Error()
    } catch { return reply(400, { error: action === 'steer' ? 'Enter a direction of up to 2,000 characters.' : 'Expected an empty JSON object.' }) }
  }
  try {
    const result = action === 'steer'
      ? await request(id, action, ownerMessage) : await request(id || null, action || null)
    return reply(200, { schema: 'nori.work-activity.v1', observedAt: new Date().toISOString(),
      ...result, resumeEnabled: allowWrites === true })
  } catch (error) {
    return reply(503, { error: MESSAGES[error.message] || 'Nori Core is unavailable. Saved task status cannot be refreshed right now.' })
  }
}
