import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { noteRecall, recallKey } from '../bridge/recall-signal.mjs'

test('the recall note holds hash prefixes and a time, never the memory text', t => {
  const dir = mkdtempSync(join(tmpdir(), 'nori-recall-')); t.after(() => rmSync(dir, { recursive: true, force: true }))
  const matches = [{ id: 'history:1', text: 'a private sentence', kind: 'history', score: 0.9 }, { id: 'learned:2', text: 'another fact', score: 0.8 }]
  assert.equal(noteRecall(matches, { dataRoot: dir, now: 123 }), true)
  const raw = readFileSync(join(dir, 'learning', 'last-recall.json'), 'utf8'), saved = JSON.parse(raw)
  assert.deepEqual(Object.keys(saved).sort(), ['at', 'keys']); assert.equal(saved.at, 123)
  assert.equal(raw.includes('private'), false); assert.equal(raw.includes('0.9'), false)
  // Same key the vector store uses (semantic-memory.mjs keyed): sha256(id + NUL + text).
  assert.equal(saved.keys[0], createHash('sha256').update('history:1\0a private sentence').digest('hex').slice(0, 12))
  assert.equal(recallKey(matches[1]), saved.keys[1])
})
test('nothing recalled, bad input or no data folder never throws and writes nothing', () => {
  assert.equal(noteRecall([], { dataRoot: 'Z:/nope' }), false)
  assert.equal(noteRecall(null, { dataRoot: 'Z:/nope' }), false)
  assert.equal(noteRecall([{ id: 'a', text: 'b' }], { dataRoot: '' }), false)
  assert.equal(noteRecall([{ id: 'a', text: 'b' }], { dataRoot: 'Z:/definitely/missing/drive' }), false)
})
