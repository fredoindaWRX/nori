'use strict'
// One-time owner approval for an action Nori wants to run in a connected app (owner, 2026-11-17: "scope it do it",
// after being told every action that sends or changes something would ask him first).
// The bridge writes a request file with the exact tool and arguments. The desktop app shows them in a native
// prompt and, only on Allow, writes an approval bound to that request's hash. The bridge runs the action only
// when the approval matches what it is about to send, then both files are removed: an approval is used once.
// Nothing Nori reads can create an approval; only this prompt does.
const { createHash, randomBytes } = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')

const SCHEMA = 1, ID = /^[a-f0-9]{24}$/, MAX_BODY = 16 * 1024, MAX_AGE_MS = 10 * 60_000
const digest = text => createHash('sha256').update(text).digest('hex')
const canonical = (tool, args) => JSON.stringify({ tool, arguments: args })
const folders = settings => ({ requests: path.join(settings, 'connector-requests'), approvals: path.join(settings, 'connector-approvals') })
const fileFor = (folder, id) => { if (!ID.test(String(id))) throw new Error('Invalid connector request id'); return path.join(folder, `${id}.json`) }

function readSmallJson(file) {
  const info = fs.lstatSync(file)
  if (!info.isFile() || info.isSymbolicLink() || info.size > MAX_BODY * 2) throw new Error('Unexpected connector file')
  return JSON.parse(fs.readFileSync(file, 'utf8'))
}

/** Bridge side: record exactly what would be sent. Returns { id, sha256 }. */
function writeRequest(settings, { tool, args, now = Date.now() }) {
  if (typeof tool !== 'string' || !/^[a-z_]{3,64}$/.test(tool) || !args || typeof args !== 'object' || Array.isArray(args)) throw new Error('Invalid connector request')
  const body = canonical(tool, args)
  if (body.length > MAX_BODY) throw new Error('That action is too large to show for approval')
  const id = randomBytes(12).toString('hex'), sha256 = digest(body), { requests } = folders(settings)
  fs.mkdirSync(requests, { recursive: true })
  fs.writeFileSync(fileFor(requests, id), JSON.stringify({ schema: SCHEMA, id, at: now, tool, arguments: args, sha256 }), { encoding: 'utf8', flag: 'wx' })
  return { id, sha256 }
}

/** The request as written, or an Error when it is missing, malformed, altered or too old. */
function readRequest(settings, id, now = Date.now()) {
  const request = readSmallJson(fileFor(folders(settings).requests, id))
  if (request?.schema !== SCHEMA || request.id !== id || typeof request.tool !== 'string' || !request.arguments || typeof request.arguments !== 'object'
      || digest(canonical(request.tool, request.arguments)) !== request.sha256) throw new Error('Connector request does not match its record')
  if (!Number.isFinite(request.at) || now - request.at > MAX_AGE_MS || request.at - now > 60_000) throw new Error('Connector request has expired')
  return request
}

/** 'allow' | 'deny' | null (no answer yet) for this exact request. */
function decision(settings, id, sha256) {
  try {
    const answer = readSmallJson(fileFor(folders(settings).approvals, id))
    if (answer?.schema !== SCHEMA || answer.id !== id || answer.sha256 !== sha256) return null
    return answer.decision === 'allow' ? 'allow' : answer.decision === 'deny' ? 'deny' : null
  } catch { return null }
}

/** Remove a request and its answer. An approval never outlives the one action it was given for. */
function consume(settings, id) {
  const { requests, approvals } = folders(settings)
  for (const folder of [requests, approvals]) { try { fs.unlinkSync(fileFor(folder, id)) } catch {} }
}

/** Main-process side. `ask(request)` shows the native prompt and resolves true only on an explicit Allow. */
function createConnectorApprover({ settings, ask, now = Date.now }) {
  let busy = false
  return Object.freeze({
    async approve(id) {
      if (busy) return { approved: false, reason: 'busy' }
      busy = true
      try {
        const request = readRequest(settings, id, now())
        const yes = await ask({ id: request.id, tool: request.tool, arguments: request.arguments })
        // What is approved must still be what the owner was shown.
        const again = readRequest(settings, id, now())
        if (again.sha256 !== request.sha256) return { approved: false, reason: 'changed' }
        const { approvals } = folders(settings)
        fs.mkdirSync(approvals, { recursive: true })
        fs.writeFileSync(fileFor(approvals, id), JSON.stringify({ schema: SCHEMA, id, sha256: request.sha256, decision: yes === true ? 'allow' : 'deny', at: now() }), 'utf8')
        return { approved: yes === true, reason: yes === true ? 'granted' : 'declined' }
      } finally { busy = false }
    },
  })
}

/** Text for the prompt: the tool and its arguments exactly as they will be sent, bounded. */
function describeRequest(request, limit = 2600) {
  const text = JSON.stringify(request.arguments, null, 2)
  return text.length > limit ? `${text.slice(0, limit)}\n… (${text.length - limit} more characters not shown)` : text
}

module.exports = { writeRequest, readRequest, decision, consume, createConnectorApprover, describeRequest, MAX_AGE_MS }
