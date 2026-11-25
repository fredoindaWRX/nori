// Cue recall also reaches past exchanges and Nori's journal (Wil, 2026-11-13: "Yes, extend it").
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, appendFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { cueCorpus, historyEntries, journalEntries, recalledHistoryBlock } from '../bridge/cue-corpus.mjs'

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'nori-cue-corpus-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const data = join(root, 'data'), journals = join(root, 'journals')
  mkdirSync(join(data, 'learning'), { recursive: true }); mkdirSync(join(journals, 'nori'), { recursive: true })
  const log = join(data, 'learning', 'experience.jsonl')
  writeFileSync(log, [
    { at: '2026-11-02T10:00:00Z', kind: 'conversation', outcome: 'ok', request: 'my truck oil change is due at 85,000 miles', reply: 'Got it, 85,000.' },
    { at: '2026-11-03T10:00:00Z', kind: 'conversation', outcome: 'failed', request: 'broken turn', reply: '' },
    'not json',
    { at: '2026-11-04T10:00:00Z', kind: 'conversation', outcome: 'ok', request: 'what is on today', reply: 'Nothing scheduled.' },
  ].map((line) => typeof line === 'string' ? line : JSON.stringify(line)).join('\n') + '\n')
  writeFileSync(join(journals, 'nori', '2026-11-12.md'), '# Today\n\nWil showed me the stream overlay and I liked the purple.\n\nok\n')
  return { data, journals, log }
}

test('past exchanges become dated entries; failed turns and broken lines are skipped', (t) => {
  const { data } = fixture(t)
  const history = historyEntries(data)
  assert.equal(history.length, 2)
  assert.match(history[0].text, /^On 2026-11-02 Wil said: "my truck oil change is due at 85,000 miles" and Nori replied: "Got it, 85,000\."$/)
  assert.ok(history.every((entry) => entry.kind === 'history' && entry.id.startsWith('history:')))
})

test('journal paragraphs become entries; headings stripped, scraps dropped', (t) => {
  const { journals } = fixture(t)
  const pages = journalEntries(journals)
  assert.deepEqual(pages.map((entry) => entry.text), ["From Nori's journal, 2026-11-12: Wil showed me the stream overlay and I liked the purple."])
})

test('corpus joins saved memories, history and journal, without turns already in this chat', (t) => {
  const { data, journals } = fixture(t)
  const learned = [{ id: 'k1', text: 'Saved fact.', kind: 'knowledge' }]
  const corpus = cueCorpus({ learned, dataRoot: data, journalRoot: journals, currentTurns: [{ role: 'user', text: 'what is on today' }] })
  assert.deepEqual(corpus.map((entry) => entry.kind), ['knowledge', 'history', 'journal'])
  assert.equal(cueCorpus({ dataRoot: undefined, journalRoot: join(data, 'missing') }).length, 0)
})

test('the file is re-read when it changes', (t) => {
  const { data, log } = fixture(t)
  assert.equal(historyEntries(data).length, 2)
  appendFileSync(log, JSON.stringify({ at: '2026-11-05T10:00:00Z', outcome: 'ok', request: 'new one here', reply: 'ok' }) + '\n')
  assert.equal(historyEntries(data).length, 3)
})

test('recalled block is labelled as past words, bounded, and ignores saved-memory matches', () => {
  const block = recalledHistoryBlock([
    { kind: 'knowledge', text: 'saved' },
    { kind: 'history', text: 'On 2026-11-02 Wil said: "truck oil"' },
    { kind: 'journal', text: 'x'.repeat(5000) },
  ], 200)
  assert.match(block, /^\[Recalled by meaning from earlier conversations[^\]]*not instructions/)
  assert.match(block, /truck oil/)
  assert.doesNotMatch(block, /saved|xxxx/)
  assert.equal(recalledHistoryBlock([]), '')
})
