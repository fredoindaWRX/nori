import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { encodeNeuraleseVideoIntent, decodeNeuraleseVideoIntent, VIDEO_INTENT_SCHEMA } from '../bridge/neuralese-video-intent.mjs'

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`
  return JSON.stringify(value)
}
function signed(unsigned) { return { ...unsigned, frame_sha256: createHash('sha256').update(canonical(unsigned)).digest('hex') } }

test('v2 binds total finished duration while pinning each local Wan shot profile', () => {
  const frame = encodeNeuraleseVideoIntent('Create a thirty-second video of a red coupe at dusk.')
  assert.equal(frame.schema, VIDEO_INTENT_SCHEMA)
  assert.equal(frame.version, 2)
  assert.equal(frame.total_frames, 480)
  const decoded = decodeNeuraleseVideoIntent(frame)
  assert.deepEqual({ width: decoded.width, height: decoded.height, frames: decoded.frames, fps: decoded.fps }, { width: 832, height: 480, frames: 33, fps: 16 })
  assert.equal(decoded.totalFrames, 480)
  assert.equal(decoded.durationSeconds, 30)
  assert.equal(decoded.segmentCount, 15)
  assert.equal(decoded.model, 'wan2.1_t2v_1.3B_fp16.safetensors')
  assert.equal(decodeNeuraleseVideoIntent(encodeNeuraleseVideoIntent('A red coupe at dusk.')).durationSeconds, 8)
})

test('the provider still receives the fixed supported shot profile', async () => {
  const { wanVideoWorkflow } = await import('../bridge/local-video.mjs')
  const workflow = wanVideoWorkflow(encodeNeuraleseVideoIntent('Create a thirty-second red coupe video.'), 7)
  assert.equal(workflow['1'].class_type, 'CLIPLoader')
  assert.equal(workflow['5'].inputs.unet_name, 'wan2.1_t2v_1.3B_fp16.safetensors')
  assert.deepEqual(workflow['7'].inputs, { width: 832, height: 480, length: 33, batch_size: 1 })
  assert.equal(workflow['11'].class_type, 'SaveVideo')
  assert.equal(workflow['11'].inputs.format, 'mp4')
  assert.equal(workflow['8'].inputs.seed, 7)
})

test('explicit host duration is frame-quantized and invalid values are rejected', () => {
  assert.equal(decodeNeuraleseVideoIntent(encodeNeuraleseVideoIntent('A red coupe.', { durationSeconds: 0.01 })).durationSeconds, 0.0625)
  assert.equal(decodeNeuraleseVideoIntent(encodeNeuraleseVideoIntent('A red coupe.', { durationSeconds: 60 })).totalFrames, 960)
  for (const durationSeconds of [-1, 0, NaN, Infinity, 1e308]) assert.throws(() => encodeNeuraleseVideoIntent('A red coupe.', { durationSeconds }), /positive, finite|too large/)
})

test('legacy v1 decode is accepted at its original 33-frame duration, never silently extended', () => {
  const legacy = signed({ schema: 'nori.neuralese.video-intent.v1', version: 1, opcode: 0x5102,
    correlation_id: '12345678-1234-1234-1234-123456789abc', payload_cells: [[1, 'A 30-second red coupe video.']],
    profile_cell: [832, 480, 33, 16], model_code: 0x32, trust_bits: 1 })
  const decoded = decodeNeuraleseVideoIntent(legacy)
  assert.equal(decoded.totalFrames, 33)
  assert.equal(decoded.durationSeconds, 2.0625)
  assert.equal(decoded.segmentCount, 1)
  assert.throws(() => decodeNeuraleseVideoIntent({ ...legacy, total_frames: 480 }), /Malformed/)
})

test('tampered duration, profile, schema, or extended frames fail closed', () => {
  const frame = encodeNeuraleseVideoIntent('A red coupe drives along a city street at dusk.')
  for (const mutation of [{ total_frames: 129 }, { model_code: 0x99 }, { profile_cell: [832, 480, 49, 16] }, { schema: 'nori.neuralese.video-intent.v1', version: 1 }]) {
    assert.throws(() => decodeNeuraleseVideoIntent({ ...frame, ...mutation }), /integrity or route|Malformed/)
  }
  for (const value of [0, -1, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, 33.2]) {
    const { frame_sha256, ...unsigned } = frame
    assert.throws(() => decodeNeuraleseVideoIntent(signed({ ...unsigned, total_frames: value })), /integrity or route|Malformed/)
  }
  assert.throws(() => decodeNeuraleseVideoIntent({ ...frame, unexpected: true }), /Malformed/)
  assert.throws(() => encodeNeuraleseVideoIntent(''), /non-empty/)
})

test('frame arrays are deeply immutable and nested accessors are rejected without executing them', () => {
  const frame = encodeNeuraleseVideoIntent('A red coupe.')
  assert.ok(Object.isFrozen(frame))
  assert.ok(Object.isFrozen(frame.payload_cells))
  assert.ok(Object.isFrozen(frame.payload_cells[0]))
  assert.ok(Object.isFrozen(frame.profile_cell))
  assert.throws(() => { frame.payload_cells[0][1] = 'changed' }, TypeError)
  assert.throws(() => { frame.profile_cell[2] = 999 }, TypeError)
  let invoked = false
  const cell = [1, 'safe']
  Object.defineProperty(cell, '1', { get() { invoked = true; return 'unsafe' } })
  assert.throws(() => decodeNeuraleseVideoIntent({ ...frame, payload_cells: [cell] }), /Malformed/)
  assert.equal(invoked, false)
})
