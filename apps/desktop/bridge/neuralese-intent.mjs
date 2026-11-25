/**
 * Lossless Neuralese envelope for user intent crossing the desktop bridge.
 *
 * The symbolic domain bits are routing hints only. The exact user payload is
 * retained and hashed so the receiver can detect a transport mismatch and
 * recover from the verified copy. This does not infer missing semantics,
 * authenticate a client, or grant execution authority.
 */
import { createHash, randomUUID } from 'node:crypto'
import { capabilityIntentFrame } from './nori-school.mjs'

export const NEURALESE_INTENT_SCHEMA = 'nori.neuralese.intent.v1'
export const NEURALESE_INTENT_OPCODE = 0x201
export const MAX_INTENT_BYTES = 16_000

const TURN_ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/
const FIELDS = [
  'schema', 'opcode', 'turn_id', 'provenance', 'payload_cell', 'goal',
  'domain_bits', 'domains', 'trust_flags', 'payload_sha256', 'frame_sha256',
]

function digest(value) {
  return createHash('sha256').update(JSON.stringify(value), 'utf8').digest('hex')
}

function assertText(value) {
  if (typeof value !== 'string' || Buffer.byteLength(value, 'utf8') > MAX_INTENT_BYTES) {
    throw new TypeError('Neuralese intent payload is not a bounded UTF-8 string.')
  }
  for (let index = 0; index < value.length; index++) {
    const unit = value.charCodeAt(index)
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(index + 1)
      if (!(next >= 0xdc00 && next <= 0xdfff)) throw new TypeError('Neuralese intent contains invalid Unicode.')
      index++
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      throw new TypeError('Neuralese intent contains invalid Unicode.')
    }
  }
  return value
}

function unsignedFrame(goal, turnId) {
  const capability = capabilityIntentFrame(goal)
  return {
    schema: NEURALESE_INTENT_SCHEMA,
    opcode: NEURALESE_INTENT_OPCODE,
    turn_id: turnId,
    provenance: 'desktop_human_boundary',
    payload_cell: 'user.goal',
    goal,
    domain_bits: capability.domain_bits,
    domains: capability.domains,
    trust_flags: { user_supplied: true, untrusted: true, execution_authorized: false },
    payload_sha256: digest(goal),
  }
}

export function encodeNeuraleseIntent(goal, { turnId = randomUUID() } = {}) {
  goal = assertText(goal)
  if (typeof turnId !== 'string' || !TURN_ID.test(turnId)) throw new TypeError('Invalid Neuralese intent turn ID.')
  const unsigned = unsignedFrame(goal, turnId)
  return { ...unsigned, frame_sha256: digest(unsigned) }
}

/** Mirror the query adapter's text extraction for bridge-delivered user content. */
export function encodeNeuraleseUserContent(content, options = {}) {
  const goal = typeof content === 'string'
    ? content
    : Array.isArray(content)
      ? content.filter((part) => part?.type === 'text').map((part) => part.text ?? '').join('\n')
      : ''
  return encodeNeuraleseIntent(goal, options)
}

export function decodeNeuraleseIntent(frame) {
  if (!frame || typeof frame !== 'object' || Array.isArray(frame)
    || Object.getPrototypeOf(frame) !== Object.prototype
    || Object.keys(frame).sort().join('\0') !== [...FIELDS].sort().join('\0')) {
    throw new TypeError('Malformed Neuralese intent frame.')
  }
  const goal = assertText(frame.goal)
  if (frame.schema !== NEURALESE_INTENT_SCHEMA || frame.opcode !== NEURALESE_INTENT_OPCODE
    || typeof frame.turn_id !== 'string' || !TURN_ID.test(frame.turn_id)
    || frame.provenance !== 'desktop_human_boundary' || frame.payload_cell !== 'user.goal'
    || frame.payload_sha256 !== digest(goal)
    || !frame.trust_flags || Object.getPrototypeOf(frame.trust_flags) !== Object.prototype
    || frame.trust_flags.user_supplied !== true || frame.trust_flags.untrusted !== true
    || frame.trust_flags.execution_authorized !== false) {
    throw new Error('Neuralese intent contract or payload checksum failed.')
  }
  const expected = unsignedFrame(goal, frame.turn_id)
  if (frame.frame_sha256 !== digest(expected)
    || frame.domain_bits !== expected.domain_bits
    || JSON.stringify(frame.domains) !== JSON.stringify(expected.domains)) {
    throw new Error('Neuralese intent frame integrity or domain check failed.')
  }
  return { goal, turnId: frame.turn_id, domainBits: frame.domain_bits, domains: [...frame.domains] }
}

/**
 * Prefer a verified frame on a one-copy mismatch; otherwise preserve the raw
 * text by rebuilding the local frame. Missing/corrupt frame metadata never
 * causes a user request to disappear. The returned status is diagnostic only.
 */
export function recoverNeuraleseIntent(frame, transportedText, { turnId } = {}) {
  const raw = assertText(transportedText)
  if (frame == null) return { goal: raw, status: 'unframed', frame: encodeNeuraleseIntent(raw, { turnId }) }
  try {
    const decoded = decodeNeuraleseIntent(frame)
    if (decoded.goal === raw) return { ...decoded, status: 'verified', frame }
    return { ...decoded, status: 'recovered_from_frame', frame }
  } catch {
    return { goal: raw, status: 'reframed_from_transport', frame: encodeNeuraleseIntent(raw, { turnId }) }
  }
}
