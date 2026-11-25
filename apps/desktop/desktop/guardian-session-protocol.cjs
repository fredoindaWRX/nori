// Authenticated transport format only. No PID adoption, Job/lease release,
// production activation, arbitrary endpoint or unbounded diagnostic payload.
const { createHmac, timingSafeEqual } = require('node:crypto')
const KINDS = Object.freeze(['challenge', 'attached', 'ready', 'quitting', 'terminal', 'ack'])
const MAX_FRAME_BYTES = 512
const FLAGS = Object.freeze({ failed: 1, normalShutdown: 2, cleanupVerified: 4,
  ownershipReleased: 8, bootComplete: 16, rendererReady: 32 })
const hex = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)
const uint = value => Number.isInteger(value) && value >= 0 && value <= 0xffffffff
const positive = value => uint(value) && value > 0
function validateFields(fields) {
  if (!fields || typeof fields !== 'object' || Array.isArray(fields) ||
    Object.keys(fields).sort().join(',') !== 'challenge,controllerPid,flags,guiPid,kind,nonce,sequence' ||
    !KINDS.includes(fields.kind) || !hex(fields.nonce) || !hex(fields.challenge) ||
    !positive(fields.controllerPid) || !positive(fields.guiPid) || !uint(fields.sequence) ||
    !Number.isInteger(fields.flags) || fields.flags < 0 || fields.flags > 63)
    throw Error('Invalid bounded guardian frame')
  const { kind, sequence, flags } = fields
  if ((kind === 'challenge' ? sequence !== 0 || flags !== 0 : sequence === 0) ||
    kind === 'attached' && (sequence !== 1 || flags !== 0) || kind === 'ready' && flags !== 48 ||
    flags & FLAGS.ownershipReleased && !(flags & FLAGS.cleanupVerified) ||
    flags & FLAGS.normalShutdown && ((flags & FLAGS.failed) || (flags & 48) !== 48) ||
    ['quitting', 'ready'].includes(kind) && (flags & 12)) throw Error('Invalid guardian frame flags or sequence')
  return fields
}
function unsigned(fields) {
  validateFields(fields)
  return ['NG1', fields.kind, fields.nonce, fields.challenge, fields.controllerPid,
    fields.guiPid, fields.sequence, fields.flags].join('|')
}
function mac(text, key) {
  if (!hex(key)) throw Error('Invalid guardian session key')
  return createHmac('sha256', Buffer.from(key, 'hex')).update(text, 'ascii').digest('hex')
}
function encodeFrame(fields, key) {
  const payload = unsigned(fields)
  const frame = `${payload}|${mac(payload, key)}\n`
  if (Buffer.byteLength(frame) > MAX_FRAME_BYTES) throw Error('Guardian frame exceeds bound')
  return frame
}
function decodeFrame(line, key) {
  if (typeof line !== 'string' || Buffer.byteLength(line) > MAX_FRAME_BYTES ||
    !/^[\x20-\x7e]+\n$/.test(line)) throw Error('Invalid bounded guardian wire frame')
  const parts = line.slice(0, -1).split('|')
  if (parts.length !== 9 || parts[0] !== 'NG1' || !hex(parts[8]) ||
    [parts[4], parts[5], parts[6], parts[7]].some(value => !/^(?:0|[1-9][0-9]{0,9})$/.test(value)))
    throw Error('Invalid guardian wire fields')
  const fields = validateFields({ kind: parts[1], nonce: parts[2], challenge: parts[3],
    controllerPid: Number(parts[4]), guiPid: Number(parts[5]), sequence: Number(parts[6]), flags: Number(parts[7]) })
  const expected = Buffer.from(mac(unsigned(fields), key), 'hex'), actual = Buffer.from(parts[8], 'hex')
  if (!timingSafeEqual(expected, actual)) throw Error('Guardian authentication failed')
  return Object.freeze(fields)
}
function flagsFromOutcome(outcome, { normalShutdown = false } = {}) {
  let flags = 0
  for (const [name, bit] of Object.entries(FLAGS)) {
    const value = name === 'normalShutdown' ? normalShutdown : outcome?.[name]
    if (typeof value !== 'boolean') throw Error('Explicit bounded guardian health booleans required')
    if (value) flags |= bit
  }
  return flags
}
module.exports = { KINDS, FLAGS, MAX_FRAME_BYTES, encodeFrame, decodeFrame, flagsFromOutcome }
