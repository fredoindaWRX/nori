import { timingSafeEqual } from 'node:crypto'
import { win32 } from 'node:path'
import { submitBackgroundWorker } from './worker-submit.mjs'
import { createWorkActivityClient } from './work-activity.mjs'

// Submission/status only. This interface deliberately has no confirmation,
// capability activation, cancellation, shell, or arbitrary Core proxy route.
export function createMentorWorkHandler({ environment = process.env,
  submit = submitBackgroundWorker, activity = createWorkActivityClient({ environment }) } = {}) {
  let busy = false
  return async (req, res) => {
    if (!req.url?.startsWith('/mentor/work')) return false
    const reply = (status, value) => {
      res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' })
      res.end(JSON.stringify(value))
      return true
    }
    const key = environment.NORI_MENTOR_TOKEN
    const supplied = req.headers.authorization
    if (!/^[a-f0-9]{64}$/.test(key || '') || typeof supplied !== 'string'
        || Buffer.byteLength(supplied) !== 71 || !timingSafeEqual(Buffer.from(supplied), Buffer.from(`Bearer ${key}`))
        || req.headers.origin || req.headers['sec-fetch-site']
        || !['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress)) {
      return reply(403, { error: 'mentor_access_denied' })
    }
    const match = /^\/mentor\/work(?:\/([a-f0-9]{32}))?$/.exec(req.url)
    if (!match) return reply(404, { error: 'unknown_mentor_operation' })
    if (req.method === 'GET' && match[1]) {
      try { return reply(200, await activity(match[1])) }
      catch { return reply(503, { error: 'task_status_unavailable' }) }
    }
    if (req.method !== 'POST' || match[1]) return reply(405, { error: 'unsupported_mentor_operation' })
    if (busy) return reply(409, { error: 'mentor_submission_busy' })
    if (req.headers['content-type'] !== 'application/json') return reply(415, { error: 'json_required' })
    busy = true
    let timer
    try {
      const chunks = []
      let size = 0
      const body = await Promise.race([
        (async () => {
          for await (const chunk of req) {
            size += chunk.length
            if (size > 16384) throw new Error('invalid_request')
            chunks.push(chunk)
          }
          return JSON.parse(Buffer.concat(chunks).toString('utf8'))
        })(),
        new Promise((_, reject) => { timer = setTimeout(() => { req.destroy(); reject(new Error('invalid_request')) }, 5000) }),
      ])
      // The read deadline must not kill a valid request while Core admits it.
      clearTimeout(timer)
      if (!body || typeof body !== 'object' || Array.isArray(body)
          || Object.keys(body).sort().join(',') !== 'allowed,context,goal,taskId,workspace'
          || !/^[a-f0-9]{32}$/.test(body.taskId || '')
          || typeof body.goal !== 'string' || !body.goal.trim() || body.goal.length > 8000
          || typeof body.workspace !== 'string' || !win32.isAbsolute(body.workspace)
          || typeof environment.NORI_AIDER_WORKSPACE_ROOT !== 'string'
          || win32.resolve(body.workspace).toLowerCase() !== win32.resolve(environment.NORI_AIDER_WORKSPACE_ROOT).toLowerCase()
          || !Array.isArray(body.allowed) || !body.allowed.length || body.allowed.length > 24
          || !Array.isArray(body.context) || body.context.length > 24
          || [...body.allowed, ...body.context].some(p => typeof p !== 'string' || !p.trim() || p.length > 2048)) {
        return reply(400, { error: 'invalid_mentor_request' })
      }
      // Core validates exact file paths and reuses the existing task approval.
      try {
        const receipt = JSON.parse(await submit({ ...body, environment }))
        return reply(202, receipt)
      } catch {
        return reply(503, { error: 'submission_unconfirmed', task_id: body.taskId,
          message: 'Inspect this task ID before retrying. No completion is confirmed.' })
      }
    } catch { return reply(400, { error: 'invalid_mentor_request' }) }
    finally { clearTimeout(timer); busy = false }
  }
}
