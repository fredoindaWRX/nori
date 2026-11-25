/**
 * Symbolic Neuralese boundary for GPT-OSS project-tool handoffs.
 *
 * Frames preserve exact structured cells and detect malformed or mismatched
 * internal messages. They confer no tool authority: projectTools.call remains
 * the only dispatcher and revalidates every request against its own policy.
 */
import { createHash, randomUUID } from 'node:crypto'

const TASK_SCHEMA = 'nori.neuralese.task-plan.v2'
const RESULT_SCHEMA = 'nori.neuralese.tool-result.v1'
const ERROR_SCHEMA = 'nori.neuralese.tool-error.v1'
const CONTRACT_SCHEMA = 'nori.gpt-oss.project-tools.v1'
const MAX_FRAME_BYTES = 1024 * 1024
const PAYLOAD_CHARS = 6000
const IDENTITY = /^[A-Za-z0-9_-]{1,120}$/
const DIGEST = /^[a-f0-9]{64}$/
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const ERROR_CODES = new Set(['tool_boundary_rejected', 'host_dispatch_failed', 'tool_result_invalid'])
const TASK_FIELDS = ['contract_sha256', 'execution_authorized', 'frame_sha256', 'intent_sha256',
  'nodes', 'proposal_sha256', 'registry_sha256', 'requested_path', 'schema']
const RESULT_FIELDS = ['call_sha256', 'execution_authorized', 'frame_sha256', 'node_id',
  'opcode', 'payload_cell', 'payload_complete', 'payload_sha256', 'provenance',
  'receipt_id', 'registry_sha256', 'result_sha256', 'schema', 'task_id']

function assertUnicode(value) {
  for (let i = 0; i < value.length; i++) {
    const unit = value.charCodeAt(i)
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(i + 1)
      if (!(next >= 0xdc00 && next <= 0xdfff)) throw new TypeError('Neuralese strings must be valid Unicode.')
      i++
    } else if (unit >= 0xdc00 && unit <= 0xdfff) throw new TypeError('Neuralese strings must be valid Unicode.')
  }
}

function compareUnicode(left, right) {
  const a = [...left].map(char => char.codePointAt(0))
  const b = [...right].map(char => char.codePointAt(0))
  for (let i = 0; i < Math.min(a.length, b.length); i++) if (a[i] !== b[i]) return a[i] - b[i]
  return a.length - b.length
}

function canonical(value) {
  if (typeof value === 'string') { assertUnicode(value); return JSON.stringify(value) }
  if (value === null || typeof value === 'boolean') return JSON.stringify(value)
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('Neuralese values must be finite JSON numbers.')
    return JSON.stringify(value)
  }
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (!value || typeof value !== 'object' || Object.getPrototypeOf(value) !== Object.prototype) {
    throw new TypeError('Neuralese accepts plain JSON objects only.')
  }
  const keys = Object.keys(value)
  for (const key of keys) assertUnicode(key)
  return `{${keys.sort(compareUnicode).map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`
}

function bytes(value) {
  const result = Buffer.from(canonical(value), 'utf8')
  if (result.length > MAX_FRAME_BYTES) throw new RangeError('Neuralese frame exceeds its transport limit.')
  return result
}

function hash(value) { return createHash('sha256').update(bytes(value)).digest('hex') }
function validDigest(value) { return typeof value === 'string' && DIGEST.test(value) }

/** Convert boundary failures to a deterministic legacy result through a
 * Neuralese error frame. The frame reports failure, never grants authority. */
export function encodeNeuraleseToolError(callId, code, message) {
  if (typeof callId !== 'string' || callId.length > 4096 || !ERROR_CODES.has(code)) {
    throw new TypeError('Invalid Neuralese tool-error correlation or code.')
  }
  let safeMessage = String(message || 'The Nori tool boundary rejected this request.').slice(0, 256)
  try { assertUnicode(safeMessage) } catch { safeMessage = 'The Nori tool boundary returned an invalid text value.' }
  const unsigned = {
    schema: ERROR_SCHEMA,
    call_id_sha256: createHash('sha256').update(callId, 'utf8').digest('hex'),
    error_code: code,
    message: safeMessage,
    provenance: 'nori_host',
    execution_authorized: false,
  }
  const frame = { ...unsigned, frame_sha256: hash(unsigned) }
  const { frame_sha256: checksum, ...verified } = frame
  if (checksum !== hash(verified) || verified.execution_authorized !== false
    || verified.provenance !== 'nori_host' || verified.schema !== ERROR_SCHEMA
    || !ERROR_CODES.has(verified.error_code)) throw new Error('Neuralese tool-error integrity check failed.')
  return JSON.stringify({ executed: false, error: verified.message })
}

function registryFrom(definitions) {
  if (!Array.isArray(definitions) || definitions.length === 0) throw new TypeError('Neuralese requires the active tool registry.')
  const registry = {}
  for (const entry of definitions) {
    const fn = entry?.function
    const props = fn?.parameters?.properties
    if (entry?.type !== 'function' || typeof fn?.name !== 'string' || !props
      || Object.getPrototypeOf(props) !== Object.prototype) throw new TypeError('Invalid active tool registry.')
    const fields = Object.keys(props)
    const required = Array.isArray(fn.parameters.required) ? fn.parameters.required : []
    if (Object.keys(registry).includes(fn.name)) throw new TypeError('Invalid or duplicate active tool.')
    if (new Set(required).size !== required.length || required.some(field => !fields.includes(field))) {
      throw new TypeError('Invalid required fields in the active tool contract.')
    }
    registry[fn.name] = { fields, required }
  }
  return Object.fromEntries(Object.keys(registry).sort().map(name => [name, registry[name]]))
}

function completeCall(name, args, registry) {
  if (!Object.hasOwn(registry, name) || !args || typeof args !== 'object' || Array.isArray(args)) {
    throw new TypeError('Neuralese tool call is not in the active registry.')
  }
  const { fields, required } = registry[name]
  const normalized = { ...args }
  // The bounded read_file handler defines these defaults; make them explicit
  // cells so the typed handoff is lossless and deterministic.
  if (name === 'read_file') {
    if (!Object.hasOwn(normalized, 'start_line')) normalized.start_line = 1
    if (!Object.hasOwn(normalized, 'max_lines')) normalized.max_lines = 60
  }
  if (Object.keys(normalized).some(field => !fields.includes(field))
    || required.some(field => !Object.hasOwn(normalized, field))) {
    throw new TypeError('Neuralese tool call fields differ from the registered contract.')
  }
  return { action: name, ...Object.fromEntries(fields.filter(field => Object.hasOwn(normalized, field))
    .map(field => [field, normalized[field]])) }
}

function operationCode(name) { return Number.parseInt(createHash('sha256').update(name, 'utf8').digest('hex').slice(0, 8), 16) }

function registryRows(registry) {
  const rows = Object.keys(registry).sort().map(name => [name, registry[name].fields, registry[name].required])
  const seen = new Set()
  for (const [name] of rows) {
    const opcode = operationCode(name)
    if (seen.has(opcode)) throw new TypeError('Neuralese action opcode collision.')
    seen.add(opcode)
  }
  return rows
}

function contractDigest(registry) {
  return hash({ schema: CONTRACT_SCHEMA, registry: registryRows(registry), execution_authorized: false })
}

export function requestedProjectPath(intent) {
  if (typeof intent !== 'string' || intent.length > 20000) return null
  // Bind only explicit relative folder targets; ordinary prose must not
  // accidentally become a path constraint.
  const match = intent.match(/\b(?:under|inside|within)\s+(?:the\s+)?(?:folder\s+)?`?([A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*\/?)(?:`)?(?=[\s,.;:]|$)/i)
  if (!match) return null
  const path = match[1].replace(/\/$/, '')
  if (!path || path === '.' || path.split('/').some(part => !part || part === '.' || part === '..')) return null
  return path
}

function encodeTask(call, registry, callId, requestIntent) {
  const rows = registryRows(registry)
  const fields = registry[call.action]?.fields
  if (!fields) throw new TypeError('Neuralese action not found.')
  const plan = { status: 'proposed', steps: [{ id: 'tool_1', call, depends_on: [] }] }
  const unsigned = {
    schema: TASK_SCHEMA,
    registry_sha256: hash(rows),
    contract_sha256: contractDigest(registry),
    proposal_sha256: hash(plan),
    nodes: [['tool_1', operationCode(call.action), fields.filter(field => Object.hasOwn(call, field)).map(field => call[field]), []]],
    intent_sha256: hash(String(requestIntent || '')),
    requested_path: requestedProjectPath(requestIntent),
    execution_authorized: false,
  }
  const frame = { ...unsigned, frame_sha256: hash(unsigned) }
  return { frame, correlation_id: callId, plan }
}

function decodeTask(envelope, expectedCall, registry, callId, requestIntent) {
  const frame = envelope?.frame
  const { frame_sha256: checksum, ...unsigned } = frame || {}
  if (envelope?.correlation_id !== callId || !frame || Object.keys(frame).sort().join(',') !== TASK_FIELDS.join(',')
    || frame.schema !== TASK_SCHEMA || frame.execution_authorized !== false
    || !validDigest(checksum) || hash(unsigned) !== checksum
    || frame.registry_sha256 !== hash(registryRows(registry))
    || frame.contract_sha256 !== contractDigest(registry)
    || frame.intent_sha256 !== hash(String(requestIntent || ''))
    || frame.requested_path !== requestedProjectPath(requestIntent)
    || frame.proposal_sha256 !== hash({ status: 'proposed', steps: [{ id: 'tool_1', call: expectedCall, depends_on: [] }] })) {
    throw new Error('Neuralese task frame integrity or contract check failed; no tool was dispatched.')
  }
  const node = frame.nodes?.[0]
  if (frame.nodes?.length !== 1 || node?.length !== 4 || node[0] !== 'tool_1'
    || node[1] !== operationCode(expectedCall.action)
    || hash(node[2]) !== hash(registry[expectedCall.action].fields
      .filter(field => Object.hasOwn(expectedCall, field)).map(field => expectedCall[field]))
    || node[3].length !== 0) throw new Error('Neuralese task frame changed the proposed action; no tool was dispatched.')
  return expectedCall
}

function encodeResult(call, resultText, registry, callId) {
  const result = JSON.parse(resultText)
  if (!result || typeof result !== 'object' || Array.isArray(result)) throw new TypeError('Tool result must be a JSON object.')
  const encoded = JSON.stringify(result)
  const complete = encoded.length <= PAYLOAD_CHARS
  const payload = complete ? result : { excerpt: [...encoded].slice(0, PAYLOAD_CHARS).join(''), truncated: true }
  const receiptId = randomUUID()
  const unsigned = {
    schema: RESULT_SCHEMA,
    registry_sha256: hash(registryRows(registry)),
    opcode: operationCode(call.action),
    task_id: `task_${callId.replace(/[^A-Za-z0-9_-]/g, '_')}`,
    node_id: 'tool_1',
    receipt_id: receiptId,
    call_sha256: hash(call),
    result_sha256: hash(result),
    payload_cell: 'result',
    payload_sha256: hash(payload),
    payload_complete: complete,
    provenance: 'untrusted_tool_data',
    execution_authorized: false,
  }
  return { frame: { ...unsigned, frame_sha256: hash(unsigned) }, payload, result, receiptId }
}

function decodeResult(envelope, call, registry, callId) {
  const frame = envelope?.frame
  const payload = envelope?.payload
  const { frame_sha256: checksum, ...unsigned } = frame || {}
  if (!frame || Object.keys(frame).sort().join(',') !== RESULT_FIELDS.join(',')
    || frame.schema !== RESULT_SCHEMA || frame.payload_cell !== 'result'
    || frame.provenance !== 'untrusted_tool_data' || frame.execution_authorized !== false
    || frame.payload_complete !== true || frame.registry_sha256 !== hash(registryRows(registry))
    || frame.opcode !== operationCode(call.action) || frame.task_id !== `task_${callId.replace(/[^A-Za-z0-9_-]/g, '_')}`
    || frame.node_id !== 'tool_1' || !UUID.test(frame.receipt_id) || !validDigest(checksum)
    || hash(unsigned) !== checksum || frame.call_sha256 !== hash(call)
    || frame.result_sha256 !== hash(envelope.result) || frame.payload_sha256 !== hash(payload)
    || hash(payload) !== hash(envelope.result)) {
    throw new Error('Neuralese result frame integrity or provenance check failed.')
  }
  return JSON.stringify(payload)
}

/** Validate an untrusted model proposal, dispatch only through host policy,
 * then verify the returned untrusted-data frame before handing it back. */
export async function callThroughNeuralese(projectTools, name, args, options, callId, requestIntent = '') {
  const proposal = encodeProjectToolProposal(projectTools.definitions, name, args, callId, requestIntent)
  const registry = registryFrom(projectTools.definitions)
  const validatedCall = decodeTask(proposal, proposal.call, registry, callId, requestIntent)
  const requestedPath = proposal.frame.requested_path
  if (requestedPath && registry[validatedCall.action].fields.includes('path') && options?.enforceRequestedPath !== false) {
    const proposedPath = validatedCall.path.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/$/, '')
    const matchesScope = validatedCall.action === 'list_dir' || validatedCall.action === 'list_skill_catalog'
      ? proposedPath.toLowerCase() === requestedPath.toLowerCase()
      : proposedPath.toLowerCase().startsWith(`${requestedPath.toLowerCase()}/`)
    if (!matchesScope) {
      return encodeNeuraleseToolError(callId, 'tool_boundary_rejected',
        `Requested project scope is ${requestedPath}; proposed path is outside that scope.`)
    }
  }
  let resultText
  try {
    // The bounded reader must fit the complete authenticated payload cell.
    // Truncating the encoded frame afterward intentionally fails validation.
    const boundedRead = ['read_file', 'list_dir', 'list_skill_catalog'].includes(validatedCall.action)
    const dispatchOptions = boundedRead
      ? { ...options, maxBytes: Math.min(options?.maxBytes ?? PAYLOAD_CHARS, PAYLOAD_CHARS) }
      : options
    resultText = await projectTools.call(validatedCall.action,
      Object.fromEntries(registry[validatedCall.action].fields
        .filter(field => Object.hasOwn(validatedCall, field)).map(field => [field, validatedCall[field]])), dispatchOptions)
  } catch (error) {
    return encodeNeuraleseToolError(callId, 'host_dispatch_failed',
      String(error?.message || 'The host project reader could not complete this request.'))
  }
  const envelope = encodeResult(validatedCall, resultText, registry, callId)
  return decodeResult(envelope, validatedCall, registry, callId)
}

/** Encode an untrusted proposal as a bounded, non-authoritative Neuralese frame. */
export function encodeProjectToolProposal(definitions, name, args, callId, requestIntent = '') {
  if (typeof callId !== 'string' || !IDENTITY.test(callId)) {
    throw new TypeError('Neuralese requires a bounded model tool-call identity.')
  }
  const registry = registryFrom(definitions)
  const call = completeCall(name, args, registry)
  return { ...encodeTask(call, registry, callId, requestIntent), call }
}
