import test from 'node:test'
import assert from 'node:assert/strict'
import {
  decodeNeuraleseIntent, encodeNeuraleseIntent, NEURALESE_INTENT_OPCODE,
  NEURALESE_INTENT_SCHEMA, encodeNeuraleseUserContent, recoverNeuraleseIntent,
} from '../bridge/neuralese-intent.mjs'

test('desktop ingress preserves exact Unicode text and emits symbolic domains without authority', () => {
  const goal = 'Make Nori listen, then create a local skill: café 🎧'
  const frame = encodeNeuraleseIntent(goal, { turnId: 'turn-7' })
  assert.equal(frame.schema, NEURALESE_INTENT_SCHEMA)
  assert.equal(frame.opcode, NEURALESE_INTENT_OPCODE)
  assert.equal(frame.goal, goal)
  assert.equal(frame.trust_flags.user_supplied, true)
  assert.equal(frame.trust_flags.untrusted, true)
  assert.equal(frame.trust_flags.execution_authorized, false)
  assert.equal(frame.domain_bits, 0x32)
  assert.deepEqual(decodeNeuraleseIntent(frame), {
    goal, turnId: 'turn-7', domainBits: 0x32, domains: ['LISTEN', 'CREATE', 'ACT'],
  })
})

test('a one-copy transport mismatch recovers the verified exact goal payload', () => {
  const frame = encodeNeuraleseIntent('Use the local model for this task.', { turnId: 'turn-8' })
  const recovered = recoverNeuraleseIntent(frame, 'Use the local model for this tasj.', { turnId: 'turn-8' })
  assert.equal(recovered.status, 'recovered_from_frame')
  assert.equal(recovered.goal, 'Use the local model for this task.')
})

test('desktop user-content framing mirrors the bridge text extraction for image turns', () => {
  const frame = encodeNeuraleseUserContent([
    { type: 'image', source: { type: 'base64', data: 'not-read-by-intent-parser' } },
    { type: 'text', text: 'What is in this image?' },
  ], { turnId: 'turn-image-1' })
  assert.equal(decodeNeuraleseIntent(frame).goal, 'What is in this image?')
  assert.equal(frame.trust_flags.execution_authorized, false)
})

test('a corrupted frame preserves the other intact transport copy and reframes it', () => {
  const frame = encodeNeuraleseIntent('Keep this request intact.', { turnId: 'turn-9' })
  frame.goal = 'Altered request.'
  const recovered = recoverNeuraleseIntent(frame, 'Keep this request intact.', { turnId: 'turn-9' })
  assert.equal(recovered.status, 'reframed_from_transport')
  assert.equal(decodeNeuraleseIntent(recovered.frame).goal, 'Keep this request intact.')
})

test('missing frame preserves the transport text and invalid payloads never get truncated', () => {
  const raw = recoverNeuraleseIntent(null, 'Plain request.', { turnId: 'turn-10' })
  assert.equal(raw.status, 'unframed')
  assert.equal(raw.goal, 'Plain request.')
  assert.throws(() => encodeNeuraleseIntent('x'.repeat(16_001)), /bounded UTF-8/)
  assert.throws(() => encodeNeuraleseIntent('\ud800'), /invalid Unicode/)
})

test('frame tampering and unknown contract fields are rejected by the decoder', () => {
  const frame = encodeNeuraleseIntent('No action is authorized.', { turnId: 'turn-11' })
  assert.throws(() => decodeNeuraleseIntent({ ...frame, goal: 'Run actions.' }), /checksum|integrity/)
  assert.throws(() => decodeNeuraleseIntent({ ...frame, execution_authorized: true }), /Malformed/)
})
