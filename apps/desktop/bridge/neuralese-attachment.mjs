/** Integrity-checked Neuralese frame for a user-selected local text attachment. */
import { createHash } from 'node:crypto'

export const NEURALESE_ATTACHMENT_SCHEMA = 'nori.neuralese.attachment.v1'
export const NEURALESE_ATTACHMENT_OPCODE = 0xA771
export const MAX_ATTACHMENT_BYTES = 12 * 1024

const TURN_ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/
const EXTENSIONS = new Set(['.txt', '.md', '.csv', '.json', '.jsonl', '.xml', '.yaml', '.yml',
  '.toml', '.ini', '.log', '.py', '.js', '.ts', '.tsx', '.html', '.css', '.sql'])
const FIELDS = ['schema', 'opcode', 'turn_id', 'provenance', 'payload_cell', 'filename',
  'payload', 'payload_sha256', 'trust_flags', 'frame_sha256']

function digest(value) {
  return createHash('sha256').update(JSON.stringify(value), 'utf8').digest('hex')
}

function checkedInput(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)
    || Object.keys(input).sort().join(',') !== 'filename,text'
    || typeof input.filename !== 'string' || typeof input.text !== 'string') {
    throw new TypeError('Neuralese attachment requires only a filename and UTF-8 text payload.')
  }
  const { filename, text } = input
  if (!filename || filename.length > 120 || filename !== filename.trim()
    || /[\\/:*?"<>|\0]/.test(filename) || filename.startsWith('.') || filename.includes('..')) {
    throw new TypeError('Neuralese attachment filename must be a plain local filename.')
  }
  const extension = filename.slice(filename.lastIndexOf('.')).toLowerCase()
  if (!EXTENSIONS.has(extension) || filename.slice(0, -extension.length).trim() === '') {
    throw new TypeError('Neuralese attachment file type is not supported.')
  }
  if (text.includes('\0') || Buffer.byteLength(text, 'utf8') > MAX_ATTACHMENT_BYTES) {
    throw new RangeError('Neuralese attachment text exceeds its local UTF-8 size limit.')
  }
  for (let index = 0; index < text.length; index++) {
    const unit = text.charCodeAt(index)
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = text.charCodeAt(index + 1)
      if (!(next >= 0xdc00 && next <= 0xdfff)) throw new TypeError('Neuralese attachment contains invalid Unicode.')
      index++
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      throw new TypeError('Neuralese attachment contains invalid Unicode.')
    }
  }
  return { filename, text }
}

export function encodeNeuraleseAttachment(input, { turnId } = {}) {
  const { filename, text } = checkedInput(input)
  if (typeof turnId !== 'string' || !TURN_ID.test(turnId)) throw new TypeError('Neuralese attachment requires its originating turn ID.')
  const unsigned = {
    schema: NEURALESE_ATTACHMENT_SCHEMA,
    opcode: NEURALESE_ATTACHMENT_OPCODE,
    turn_id: turnId,
    provenance: 'desktop_user_selected_local_file',
    payload_cell: 'user.attachment.text',
    filename,
    payload: text,
    payload_sha256: digest({ filename, text }),
    trust_flags: { user_supplied: true, untrusted: true, execution_authorized: false },
  }
  return { ...unsigned, frame_sha256: digest(unsigned) }
}

export function decodeNeuraleseAttachment(frame, { turnId } = {}) {
  if (!frame || typeof frame !== 'object' || Array.isArray(frame)
    || Object.getPrototypeOf(frame) !== Object.prototype
    || Object.keys(frame).sort().join('\0') !== [...FIELDS].sort().join('\0')) {
    throw new TypeError('Malformed Neuralese attachment frame.')
  }
  const { frame_sha256: checksum, ...unsigned } = frame
  const { filename, text } = checkedInput({ filename: frame.filename, text: frame.payload })
  const trust = frame.trust_flags
  if (frame.schema !== NEURALESE_ATTACHMENT_SCHEMA || frame.opcode !== NEURALESE_ATTACHMENT_OPCODE
    || typeof frame.turn_id !== 'string' || !TURN_ID.test(frame.turn_id)
    || (turnId !== undefined && frame.turn_id !== turnId)
    || frame.provenance !== 'desktop_user_selected_local_file' || frame.payload_cell !== 'user.attachment.text'
    || frame.payload_sha256 !== digest({ filename, text })
    || !trust || Object.getPrototypeOf(trust) !== Object.prototype
    || Object.keys(trust).sort().join(',') !== 'execution_authorized,untrusted,user_supplied'
    || trust.user_supplied !== true || trust.untrusted !== true || trust.execution_authorized !== false
    || checksum !== digest(unsigned)) {
    throw new Error('Neuralese attachment integrity, provenance, or trust validation failed.')
  }
  return { filename, text, turnId: frame.turn_id, provenance: frame.provenance,
    trustFlags: { ...trust }, payloadSha256: frame.payload_sha256 }
}
