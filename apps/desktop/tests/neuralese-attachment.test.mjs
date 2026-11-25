import test from 'node:test'
import assert from 'node:assert/strict'
import { encodeNeuraleseAttachment, decodeNeuraleseAttachment, MAX_ATTACHMENT_BYTES } from '../bridge/neuralese-attachment.mjs'

test('local attachment frame round-trips UTF-8 data with untrusted and no-authority flags', () => {
  const input = { filename: 'nori-local-attachment-probe.txt', text: 'synthetic marker: NORI_LOCAL_ATTACHMENT_OK\n' }
  const frame = encodeNeuraleseAttachment(input, { turnId: 'ask-attachment-1' })
  const decoded = decodeNeuraleseAttachment(frame, { turnId: 'ask-attachment-1' })
  assert.equal(decoded.filename, input.filename)
  assert.equal(decoded.text, input.text)
  assert.equal(decoded.provenance, 'desktop_user_selected_local_file')
  assert.deepEqual(decoded.trustFlags, { user_supplied: true, untrusted: true, execution_authorized: false })
})

test('Neuralese attachment rejects payload tampering and a different turn binding', () => {
  const frame = encodeNeuraleseAttachment({ filename: 'notes.md', text: 'local data' }, { turnId: 'ask-attachment-2' })
  assert.throws(() => decodeNeuraleseAttachment({ ...frame, payload: 'changed' }), /integrity|provenance|trust/i)
  assert.throws(() => decodeNeuraleseAttachment(frame, { turnId: 'ask-attachment-3' }), /integrity|provenance|trust/i)
})

test('Neuralese attachment rejects paths, unsupported file types, binary text, and oversize payloads', () => {
  for (const input of [
    { filename: '../notes.txt', text: 'x' },
    { filename: 'notes.pdf', text: 'x' },
    { filename: 'notes.txt', text: 'x\0y' },
    { filename: 'notes.txt', text: 'x'.repeat(MAX_ATTACHMENT_BYTES + 1) },
  ]) {
    assert.throws(() => encodeNeuraleseAttachment(input, { turnId: 'ask-attachment-4' }))
  }
})
