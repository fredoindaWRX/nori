import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
const executable = fileURLToPath(new URL('../norama-json-prefix-test.exe', import.meta.url))
const classify = buffers => {
  const result = spawnSync(executable, ['--classify-lines'], {
    input: buffers.map(value => Buffer.from(value).toString('hex')).join('\n') + '\n',
    encoding: 'utf8', windowsHide: true, timeout: 10000, maxBuffer: 1048576,
  })
  assert.equal(result.status, 0, result.stderr)
  const states = result.stdout.trim().split('\n').map(value => value.trim())
  assert.equal(states.length, buffers.length)
  return states
}
test('independent JSON prefix guard accepts real JSON.stringify trees and every byte split', () => {
  const objects = Array.from({ length: 120 }, (_, i) => ({
    ['key' + i]: [null, true, false, i - 80, i / 7, { path: 'notes.txt', text: '中文🙂 café\\\"\n\t' }],
    empty: {}, nested: { value: [['x', 'y'], []] },
  }))
  const texts = objects.map(value => JSON.stringify(value))
  assert.deepEqual(classify(texts), texts.map(() => 'C'))
  for (const text of [texts[0], '{"x":"\\uD83D\\uDE42","n":-1.2e-4}', '{"x": "🙂中文"}']) {
    const bytes = Buffer.from(text)
    const splits = Array.from({ length: bytes.length + 1 }, (_, length) => bytes.subarray(0, length))
    assert.deepEqual(classify(splits), splits.map((_, i) => i === bytes.length ? 'C' : 'P'))
  }
})
test('guard rejects illegal byte sequences, control escapes and completed JSON with trailing material', () => {
  const prefix = Buffer.from('{"x":"')
  const invalidUtf8 = [[0x80], [0xc0, 0x80], [0xe0, 0x80], [0xed, 0xa0], [0xf0, 0x80], [0xf4, 0x90], [0xf5], [0xc2, 0x22]]
  const samples = invalidUtf8.map(bytes => Buffer.concat([prefix, Buffer.from(bytes)]))
  samples.push(...['{"x":"\n"}', '{"x":[true false]}', '{} prose', '```json\n{}', '{"x":+1}',
    '{"x":.1}', '{"x":0x12}', '{"x":False}', '{"x":true:1}', '{"x":[]}x'].map(value => Buffer.from(value)))
  assert.deepEqual(classify(samples), samples.map(() => 'I'))
})
test('syntax guard deliberately does not certify duplicate keys, finite numeric values or a schema', () => {
  assert.deepEqual(classify(['{"x":1,"x":2}', '{"x":1e999}', '{"unexpected":true}']), ['C', 'C', 'C'])
})
