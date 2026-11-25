import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

test('saved-memory inventory is scoped, editable, exportable as JSON data, and forgettable', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'nori-memory-view-'))
  const file = join(root, 'learned-guidance.json')
  const previousPath = process.env.NORI_LEARNING_FILE
  process.env.NORI_LEARNING_FILE = file
  t.after(() => {
    if (previousPath === undefined) delete process.env.NORI_LEARNING_FILE
    else process.env.NORI_LEARNING_FILE = previousPath
    rmSync(root, { recursive: true, force: true })
  })

  writeFileSync(file, JSON.stringify({
    schema: 'nori.learned-guidance.v2',
    knowledge: [{ text: 'The local workspace is C drive.', at: '2026-10-19T10:00:00.000Z' }],
    preferences: [{ text: 'Always show a clear test result.', at: '2026-10-19T11:00:00.000Z' }],
    feedback: [],
  }))
  const url = new URL('../bridge/nori-learning.mjs', import.meta.url)
  url.searchParams.set('test', `${Date.now()}-${Math.random()}`)
  const memory = await import(url.href)

  const initial = memory.listLearnedMemory()
  assert.equal(initial.complete, false)
  assert.equal(initial.scope, 'learned-guidance-only')
  assert.equal(initial.entries.length, 2)
  assert.deepEqual(initial.entries.map((entry) => entry.label), ['Saved preferences', 'Saved knowledge'])
  assert.match(initial.note, /does not include chat transcripts/i)

  const edited = memory.editLearnedMemory(initial.entries[1].id, 'The source workspace is C drive.')
  assert.equal(edited.entries.find((entry) => entry.kind === 'knowledge').text, 'The source workspace is C drive.')
  assert.equal(JSON.parse(readFileSync(file, 'utf8')).knowledge[0].id, initial.entries[1].id)

  assert.throws(() => memory.editLearnedMemory(initial.entries[1].id, 'email owner@example.com'), /does not accept email/i)
  const removed = memory.deleteLearnedMemory(initial.entries[0].id)
  assert.equal(removed.entries.length, 1)
  assert.deepEqual(removed.counts, { knowledge: 1, preferences: 0, feedback: 0 })
  assert.throws(() => memory.deleteLearnedMemory(initial.entries[0].id), /no longer exists/i)
})
