/**
 * Neuralese envelope for local speech-recognition results.
 *
 * The transcript is still human text because it crossed the audio/user
 * boundary. Internally it is carried as a typed, integrity-checked payload;
 * unavailable confidence and word timing remain explicitly unavailable.
 */
const SCHEMA = 'nori.neuralese.speech-transcription.v1'
const FIELDS = ['confidence', 'execution_authorized', 'frame_sha256', 'opcode',
  'payload_cell', 'payload_sha256', 'provenance', 'schema', 'status', 'timing']

function canonical(value) {
  if (value === null || typeof value === 'boolean' || typeof value === 'number' || typeof value === 'string') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`
  throw new TypeError('Neuralese speech frame contains an unsupported value.')
}

async function digest(value) {
  const bytes = new TextEncoder().encode(typeof value === 'string' ? value : canonical(value))
  const hash = await globalThis.crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(hash)].map(byte => byte.toString(16).padStart(2, '0')).join('')
}

export async function encodeNeuraleseSpeech(text) {
  if (typeof text !== 'string' || text.length > 20000) throw new TypeError('Transcript must be a bounded string.')
  const payload_sha256 = await digest(text)
  const unsigned = {
    schema: SCHEMA,
    opcode: 0x535454,
    status: text.trim() ? 'transcribed' : 'empty',
    payload_cell: 'human_boundary.transcript',
    payload_sha256,
    provenance: 'local_stt_untrusted_input',
    confidence: null,
    timing: null,
    execution_authorized: false,
  }
  return { frame: { ...unsigned, frame_sha256: await digest(unsigned) }, payload: text }
}

export async function decodeNeuraleseSpeech(envelope) {
  const frame = envelope?.frame
  const payload = envelope?.payload
  if (!frame || typeof payload !== 'string' || payload.length > 20000
    || Object.keys(frame).sort().join(',') !== [...FIELDS].sort().join(',')
    || frame.schema !== SCHEMA || frame.opcode !== 0x535454
    || frame.status !== (payload.trim() ? 'transcribed' : 'empty')
    || frame.payload_cell !== 'human_boundary.transcript'
    || frame.provenance !== 'local_stt_untrusted_input'
    || frame.confidence !== null || frame.timing !== null
    || frame.execution_authorized !== false
    || frame.payload_sha256 !== await digest(payload)) {
    throw new Error('Neuralese speech payload failed schema, provenance, or integrity validation.')
  }
  const { frame_sha256, ...unsigned } = frame
  if (!/^[a-f0-9]{64}$/.test(frame_sha256) || frame_sha256 !== await digest(unsigned)) {
    throw new Error('Neuralese speech frame checksum validation failed.')
  }
  return payload
}
