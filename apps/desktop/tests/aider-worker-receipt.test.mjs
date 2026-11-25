import test from 'node:test'
import assert from 'node:assert/strict'
import { createAiderWorkerReceiptValidator } from '../bridge/aider-worker-receipt.mjs'

const receipt = model => ({ outcome: 'completed', worker: 'aider-local', model,
  changed_files: ['calculator.py'], tests: 'not run by Aider', external_services: false })

test('completion follows the host-bound model across automatic, small, large and future local profiles', () => {
  for (const [id, label] of [
    ['openai/nori-auto', 'Nori automatic local coder'],
    ['openai/qwen3.5-9b', 'local Qwen3.5 9B'],
    ['openai/qwen3.8-27b', 'local Qwen3.8 27B'],
    ['openai/gpt-oss-20b', 'local GPT-OSS 20B'],
    ['openai/future-local-profile', 'Another verified local coding profile'],
  ]) {
    const result = createAiderWorkerReceiptValidator({ id, label })(receipt(label))
    assert.equal(result.modelId, id)
    assert.equal(result.modelLabel, label)
    assert.deepEqual(result.changedFiles, ['calculator.py'])
    assert.equal(result.tests, 'not run by Aider')
  }
})

test('a valid completion for a different model is rejected', () => {
  const validate = createAiderWorkerReceiptValidator({ id: 'openai/nori-auto', label: 'Nori automatic local coder' })
  assert.throws(() => validate(receipt('local GPT-OSS 20B')), /host-bound/)
})

test('expected identity is captured before dispatch and does not follow later model changes', () => {
  const selected = { id: 'openai/nori-auto', label: 'Nori automatic local coder' }
  const validate = createAiderWorkerReceiptValidator(selected)
  selected.id = 'openai/gpt-oss-20b'
  selected.label = 'local GPT-OSS 20B'
  assert.equal(validate(receipt('Nori automatic local coder')).modelId, 'openai/nori-auto')
  assert.throws(() => validate(receipt(selected.label)), /host-bound/)
})

test('incomplete, failed, external, test-claiming and malformed receipts cannot report completion', () => {
  const validate = createAiderWorkerReceiptValidator({ id: 'openai/nori-auto', label: 'Nori automatic local coder' })
  for (const change of [
    { outcome: 'failed' }, { worker: 'other-worker' }, { tests: 'passed' }, { external_services: true },
    { changed_files: [] }, { changed_files: Array(25).fill('file.py') }, { changed_files: [null] },
    { changed_files: [{}] }, { changed_files: [''] }, { changed_files: ['x'.repeat(241)] },
    { changed_files: ['file.py\nforged'] },
  ]) assert.throws(() => validate({ ...receipt('Nori automatic local coder'), ...change }), /completed receipt/)
  for (const value of [null, [], '{}', undefined]) assert.throws(() => validate(value), /completed receipt/)
})

test('verified metadata is immutable and never propagates receipt-supplied authority', () => {
  const input = { ...receipt('Nori automatic local coder'), execution_authorized: true, approvalGranted: true }
  const result = createAiderWorkerReceiptValidator({ id: 'openai/nori-auto', label: input.model })(input)
  input.changed_files[0] = 'other.py'
  assert.deepEqual(result.changedFiles, ['calculator.py'])
  assert.equal(Object.isFrozen(result), true)
  assert.equal(Object.isFrozen(result.changedFiles), true)
  assert.equal(result.execution_authorized, undefined)
  assert.equal(result.approvalGranted, undefined)
})

test('missing or malformed host identity is refused without using defaults', () => {
  for (const identity of [null, {}, [], { id: 'remote/model', label: 'Remote' },
    { id: 'openai/nori-auto', label: '' }, { id: 'openai/nori-auto', label: 'forged\nidentity' }]) {
    assert.throws(() => createAiderWorkerReceiptValidator(identity), /Host-bound/)
  }
})
