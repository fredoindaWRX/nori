import test from 'node:test'
import assert from 'node:assert/strict'
import { memoryLabel } from '../bridge/semantic-memory.mjs'
test('a memory label is its kind, its day and its first words, clipped', () => {
  assert.deepEqual(memoryLabel({ kind: 'history', day: '2026-11-14', request: 'what model are you running', text: 'On 2026-11-14 Wil said: ...' }),
    { kind: 'Conversation', day: '2026-11-14', title: 'what model are you running' })
  assert.deepEqual(memoryLabel({ kind: 'journal', day: '2026-11-13', text: "From Nori's journal, 2026-11-13: Today I learned   something." }),
    { kind: 'Journal', day: '2026-11-13', title: 'Today I learned something.' })
  const long = memoryLabel({ kind: 'knowledge', at: '2026-11-10T04:00:00Z', text: 'x'.repeat(200) })
  assert.equal(long.kind, 'Knowledge'); assert.equal(long.day, '2026-11-10'); assert.ok(long.title.length <= 72)
  assert.equal(memoryLabel({ kind: 'odd', label: 'Odd things', text: 'y' }).kind, 'Odd things')
  assert.equal(memoryLabel({ text: 'z', at: 'not a date' }).day, '')
})
