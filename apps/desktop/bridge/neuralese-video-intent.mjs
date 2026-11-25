import { createHash, randomUUID } from 'node:crypto'
import { planVideoDuration, resolveVideoDurationSeconds, VIDEO_FPS, VIDEO_SEGMENT_FRAMES } from './video-duration.mjs'

export const VIDEO_INTENT_SCHEMA = 'nori.neuralese.video-intent.v2'
export const VIDEO_INTENT_OPCODE = 0x5102
const LEGACY_SCHEMA = 'nori.neuralese.video-intent.v1'
const MAX_PROMPT_BYTES = 12000
const MAX_FRAME_BYTES = 16000
const FRAME_KEYS = ['schema','version','opcode','correlation_id','payload_cells','profile_cell','model_code','trust_bits','frame_sha256']
const MODEL_CODE = 0x32

function canonical(value) {
  if (typeof value === 'string' || value === null || typeof value === 'boolean' || (typeof value === 'number' && Number.isSafeInteger(value))) return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (!value || typeof value !== 'object' || Object.getPrototypeOf(value) !== Object.prototype) throw new TypeError('Neuralese video frames accept plain JSON only.')
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`
}

function digest(value) {
  const bytes = Buffer.from(canonical(value), 'utf8')
  if (bytes.length > MAX_FRAME_BYTES) throw new RangeError('Neuralese video frame exceeds its transport limit.')
  return createHash('sha256').update(bytes).digest('hex')
}

function freezeDeep(value) {
  if (value && typeof value === 'object') { for (const child of Object.values(value)) freezeDeep(child); Object.freeze(value) }
  return value
}

// Snapshot plain data without invoking getters, including inside payload/profile arrays.
function plainSnapshot(value, depth = 0) {
  if (depth > 6) throw new TypeError('Malformed Neuralese video-intent frame; nothing was dispatched.')
  if (value === null || typeof value !== 'object') {
    if (typeof value === 'string' || typeof value === 'boolean' || value === null || (typeof value === 'number' && Number.isSafeInteger(value))) return value
    throw new TypeError('Malformed Neuralese video-intent frame; nothing was dispatched.')
  }
  const array = Array.isArray(value)
  if (Object.getPrototypeOf(value) !== (array ? Array.prototype : Object.prototype)) throw new TypeError('Malformed Neuralese video-intent frame; nothing was dispatched.')
  const descriptors = Object.getOwnPropertyDescriptors(value)
  if (Reflect.ownKeys(descriptors).some(key => typeof key !== 'string' || !Object.hasOwn(descriptors[key], 'value'))) throw new TypeError('Malformed Neuralese video-intent frame; nothing was dispatched.')
  if (array) {
    if (value.length > 16 || Object.keys(descriptors).length !== value.length + 1 || Array.from({ length: value.length }, (_, index) => String(index)).some(key => !Object.hasOwn(descriptors, key))) throw new TypeError('Malformed Neuralese video-intent frame; nothing was dispatched.')
    return Array.from({ length: value.length }, (_, index) => plainSnapshot(descriptors[index].value, depth + 1))
  }
  if (Object.keys(descriptors).length > 16) throw new TypeError('Malformed Neuralese video-intent frame; nothing was dispatched.')
  return Object.fromEntries(Object.entries(descriptors).map(([key, descriptor]) => [key, plainSnapshot(descriptor.value, depth + 1)]))
}

export function encodeNeuraleseVideoIntent(prompt, { correlationId = randomUUID(), durationSeconds } = {}) {
  if (typeof prompt !== 'string' || !prompt.trim() || Buffer.byteLength(prompt, 'utf8') > MAX_PROMPT_BYTES) throw new TypeError('Video request needs a non-empty prompt within Nori\'s local limit.')
  if (typeof correlationId !== 'string' || !/^[0-9a-f-]{36}$/i.test(correlationId)) throw new TypeError('Invalid Neuralese video correlation ID.')
  const duration = planVideoDuration(durationSeconds === undefined ? resolveVideoDurationSeconds(prompt) : durationSeconds)
  const unsigned = {
    schema: VIDEO_INTENT_SCHEMA, version: 2, opcode: VIDEO_INTENT_OPCODE,
    correlation_id: correlationId, payload_cells: [[0x01, prompt]],
    // This is the per-shot model profile, not the finished video's duration.
    profile_cell: [832, 480, VIDEO_SEGMENT_FRAMES, VIDEO_FPS], total_frames: duration.totalFrames,
    model_code: MODEL_CODE, trust_bits: 0x01,
  }
  return freezeDeep({ ...unsigned, frame_sha256: digest(unsigned) })
}

export function decodeNeuraleseVideoIntent(frame) {
  if (!frame || typeof frame !== 'object' || Array.isArray(frame)) throw new TypeError('Malformed Neuralese video-intent frame; nothing was dispatched.')
  const data = plainSnapshot(frame)
  const legacy = data.schema === LEGACY_SCHEMA && data.version === 1
  const keys = legacy ? FRAME_KEYS : [...FRAME_KEYS, 'total_frames']
  if (Object.keys(data).sort().join(',') !== [...keys].sort().join(',')) throw new TypeError('Malformed Neuralese video-intent frame; nothing was dispatched.')
  const { frame_sha256: checksum, ...unsigned } = data
  if ((!legacy && (data.schema !== VIDEO_INTENT_SCHEMA || data.version !== 2)) || data.opcode !== VIDEO_INTENT_OPCODE || data.model_code !== MODEL_CODE || data.trust_bits !== 0x01 ||
      !Array.isArray(data.payload_cells) || data.payload_cells.length !== 1 || !Array.isArray(data.payload_cells[0]) || data.payload_cells[0].length !== 2 || data.payload_cells[0][0] !== 0x01 ||
      !Array.isArray(data.profile_cell) || data.profile_cell.length !== 4 || data.profile_cell.some((value, index) => value !== [832, 480, VIDEO_SEGMENT_FRAMES, VIDEO_FPS][index]) ||
      (!legacy && (!Number.isSafeInteger(data.total_frames) || data.total_frames < 1)) ||
      typeof data.correlation_id !== 'string' || !/^[0-9a-f-]{36}$/i.test(data.correlation_id) ||
      typeof checksum !== 'string' || !/^[a-f0-9]{64}$/.test(checksum) || digest(unsigned) !== checksum) throw new Error('Neuralese video-intent integrity or route check failed; nothing was dispatched.')
  const prompt = data.payload_cells[0][1]
  if (typeof prompt !== 'string' || !prompt.trim() || Buffer.byteLength(prompt, 'utf8') > MAX_PROMPT_BYTES) throw new TypeError('Neuralese video prompt cell is invalid; nothing was dispatched.')
  const totalFrames = legacy ? VIDEO_SEGMENT_FRAMES : data.total_frames
  return Object.freeze({ correlationId: data.correlation_id, prompt, width: 832, height: 480, frames: VIDEO_SEGMENT_FRAMES, fps: VIDEO_FPS,
    totalFrames, durationSeconds: totalFrames / VIDEO_FPS, segmentCount: Math.ceil(totalFrames / VIDEO_SEGMENT_FRAMES),
    model: 'wan2.1_t2v_1.3B_fp16.safetensors', untrustedPayload: true })
}
