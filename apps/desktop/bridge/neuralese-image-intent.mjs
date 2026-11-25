import { createHash, randomUUID } from 'node:crypto'

export const IMAGE_INTENT_SCHEMA = 'nori.neuralese.image-intent.v1'
export const IMAGE_INTENT_OPCODE = 0x5101
const MAX_PROMPT_BYTES = 12000
const MAX_FRAME_BYTES = 16000
const FRAME_KEYS = ['schema','version','opcode','correlation_id','payload_cells','dimension_cell','model_code','trust_bits','frame_sha256']
const MODEL_CODE = 0x31
const MODEL_NAME = 'z_image_turbo_int8_convrot.safetensors'

function assertUnicode(value) {
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index)
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1)
      if (!(next >= 0xdc00 && next <= 0xdfff)) throw new TypeError('Image intent contains invalid text encoding.')
      index++
    } else if (code >= 0xdc00 && code <= 0xdfff) throw new TypeError('Image intent contains invalid text encoding.')
  }
}

function canonical(value) {
  if (typeof value === 'string') { assertUnicode(value); return JSON.stringify(value) }
  if (value === null || typeof value === 'boolean') return JSON.stringify(value)
  if (typeof value === 'number' && Number.isSafeInteger(value)) return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (!value || typeof value !== 'object' || Object.getPrototypeOf(value) !== Object.prototype) {
    throw new TypeError('Neuralese image frames accept plain JSON only.')
  }
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`
}

function digest(value) {
  const data = Buffer.from(canonical(value), 'utf8')
  if (data.length > MAX_FRAME_BYTES) throw new RangeError('Neuralese image frame exceeds its transport limit.')
  return createHash('sha256').update(data).digest('hex')
}

/** Encode a user image request into Nori's typed, integrity-bound internal frame. */
export function encodeNeuraleseImageIntent(prompt, { width = 1024, height = 1024, correlationId = randomUUID() } = {}) {
  if (typeof prompt !== 'string' || !prompt.trim()) throw new TypeError('Image request needs a non-empty prompt cell.')
  assertUnicode(prompt)
  if (Buffer.byteLength(prompt, 'utf8') > MAX_PROMPT_BYTES) throw new RangeError('Image request exceeds Nori\'s local prompt limit.')
  for (const value of [width, height]) {
    if (!Number.isInteger(value) || value < 512 || value > 1536 || value % 64 !== 0) {
      throw new TypeError('Image dimensions must be supported 64-pixel multiples from 512 to 1536.')
    }
  }
  if (typeof correlationId !== 'string' || !/^[0-9a-f-]{36}$/i.test(correlationId)) throw new TypeError('Invalid Neuralese image correlation ID.')
  const unsigned = {
    schema: IMAGE_INTENT_SCHEMA,
    version: 1,
    opcode: IMAGE_INTENT_OPCODE,
    correlation_id: correlationId,
    payload_cells: [[0x01, prompt]],
    dimension_cell: [width, height],
    model_code: MODEL_CODE,
    trust_bits: 0x01,
  }
  return Object.freeze({ ...unsigned, frame_sha256: digest(unsigned) })
}

/** Decode and verify the frame at the local image-provider adapter boundary. */
export function decodeNeuraleseImageIntent(frame) {
  if (!frame || typeof frame !== 'object' || Array.isArray(frame) || Object.getPrototypeOf(frame) !== Object.prototype) {
    throw new TypeError('Malformed Neuralese image-intent frame; nothing was dispatched.')
  }
  const descriptors = Object.getOwnPropertyDescriptors(frame)
  if (Reflect.ownKeys(descriptors).some(key => typeof key !== 'string' || !FRAME_KEYS.includes(key)
      || !Object.hasOwn(descriptors[key], 'value'))
      || Object.keys(descriptors).sort().join(',') !== [...FRAME_KEYS].sort().join(',')) {
    throw new TypeError('Malformed Neuralese image-intent frame; nothing was dispatched.')
  }
  const data = Object.fromEntries(Object.entries(descriptors).map(([key, descriptor]) => [key, descriptor.value]))
  const { frame_sha256: checksum, ...unsigned } = data
  if (data.schema !== IMAGE_INTENT_SCHEMA || data.version !== 1 || data.opcode !== IMAGE_INTENT_OPCODE
      || data.model_code !== MODEL_CODE || data.trust_bits !== 0x01
      || !Array.isArray(data.payload_cells) || data.payload_cells.length !== 1
      || !Array.isArray(data.payload_cells[0]) || data.payload_cells[0].length !== 2 || data.payload_cells[0][0] !== 0x01
      || !Array.isArray(data.dimension_cell) || data.dimension_cell.length !== 2
      || typeof data.correlation_id !== 'string' || !/^[0-9a-f-]{36}$/i.test(data.correlation_id)
      || !/^[a-f0-9]{64}$/.test(checksum) || digest(unsigned) !== checksum) {
    throw new Error('Neuralese image-intent integrity or route check failed; nothing was dispatched.')
  }
  const [width, height] = data.dimension_cell
  const prompt = data.payload_cells[0][1]
  if (typeof prompt !== 'string' || !prompt.trim() || Buffer.byteLength(prompt, 'utf8') > MAX_PROMPT_BYTES
      || [width, height].some(value => !Number.isInteger(value) || value < 512 || value > 1536 || value % 64 !== 0)) {
    throw new TypeError('Neuralese image-intent cells are invalid; nothing was dispatched.')
  }
  return Object.freeze({
    correlationId: data.correlation_id,
    prompt,
    width,
    height,
    model: MODEL_NAME,
    untrustedPayload: true,
  })
}
