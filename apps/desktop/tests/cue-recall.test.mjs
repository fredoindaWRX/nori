// Cue recall (Wil, 2026-11-13): a message brings back saved memories close in
// meaning, even without shared words, and never slows or breaks a reply.
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { cueRecall, cueRecallWarming, resetCueRecallBackoff, CUE_MIN_SCORE } from '../bridge/semantic-memory.mjs'

const environment = { NORI_EMBEDDING_URL: 'http://127.0.0.1:18789', NORI_EMBEDDING_API_KEY: 'b'.repeat(64) }
// Toy embedding: axis 0 = food, axis 1 = cars, axis 2 = anything else.
const axisOf = (text) => /rice|gandules|grandmother|dish/i.test(text) ? 0 : /oil change|vehicle|car /i.test(text) ? 1 : 2
const vec = (axis) => Array.from({ length: 1024 }, (_, i) => (i === axis ? 1 : i === 3 ? 0.05 : 0))
const fakeWorker = (calls = []) => async (url, options) => {
  const texts = JSON.parse(options.body).input
  calls.push(texts)
  return { ok: true, json: async () => ({ data: texts.map((text, index) => ({ index, embedding: vec(axisOf(text)) })) }) }
}
const entries = [
  { id: 'k1', text: 'Grandma made arroz con gandules with sofrito.', kind: 'knowledge' },
  { id: 'k2', text: 'Oil change every 5,000 miles; last at 82,000.', kind: 'knowledge' },
]

test('a cue with no shared words brings back the memory close in meaning', async () => {
  const calls = []
  const fetcher = fakeWorker(calls)
  assert.deepEqual(await cueRecall('what was that rice dish my grandmother made', entries, { environment, fetcher }), [],
    'first turn only starts filling entry vectors; it does not wait for them')
  await cueRecallWarming()
  const found = await cueRecall('what was that rice dish my grandmother made', entries, { environment, fetcher })
  assert.deepEqual(found.map((match) => match.id), ['k1'])
  assert.ok(found[0].score >= CUE_MIN_SCORE)
  calls.length = 0
  await cueRecall('when does my vehicle need service', entries, { environment, fetcher })
  assert.equal(calls.length, 1, 'later turns embed only the cue')
})

test('unrelated messages bring nothing back', async () => {
  const fetcher = fakeWorker()
  await cueRecall('warm up', entries, { environment, fetcher }); await cueRecallWarming()
  assert.deepEqual(await cueRecall('tell me a joke', entries, { environment, fetcher }), [])
})

test('no worker, a foreign endpoint, errors, aborts and slow workers all give no matches without throwing', async () => {
  const fetcher = fakeWorker()
  await cueRecall('warm up', entries, { environment, fetcher }); await cueRecallWarming()
  assert.deepEqual(await cueRecall('rice dish', entries, { environment: {}, fetcher }), [])
  assert.deepEqual(await cueRecall('rice dish', entries, { environment: { ...environment, NORI_EMBEDDING_URL: 'https://example.com' }, fetcher }), [])
  assert.deepEqual(await cueRecall('rice dish', entries, { environment, fetcher: async () => ({ ok: false }) }), [])
  assert.deepEqual(await cueRecall('rice dish', entries, { environment, fetcher: async () => { throw Error('down') } }), [])
  const aborted = new AbortController(); aborted.abort()
  assert.deepEqual(await cueRecall('rice dish', entries, { environment, fetcher, signal: aborted.signal }), [])
  const slow = (url, options) => new Promise((resolve, reject) => options.signal.addEventListener('abort', () => reject(options.signal.reason)))
  const started = Date.now()
  assert.deepEqual(await cueRecall('rice dish', entries, { environment, fetcher: slow, budgetMs: 50 }), [])
  let asked = 0
  const counting = async (...args) => { asked++; return fakeWorker()(...args) }
  assert.deepEqual(await cueRecall('rice dish', entries, { environment, fetcher: counting }), [], 'after a slow turn the worker is skipped')
  assert.equal(asked, 0)
  resetCueRecallBackoff()
  assert.equal((await cueRecall('rice dish', entries, { environment, fetcher: counting })).length, 1)
  assert.ok(Date.now() - started < 1000, 'a slow worker is cut off at the budget')
})

test('cued memories appear in her context under their own heading, only if really saved', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'nori-cue-'))
  const file = join(root, 'learned-guidance.json')
  const previous = process.env.NORI_LEARNING_FILE
  process.env.NORI_LEARNING_FILE = file
  t.after(() => { if (previous === undefined) delete process.env.NORI_LEARNING_FILE; else process.env.NORI_LEARNING_FILE = previous; rmSync(root, { recursive: true, force: true }) })
  writeFileSync(file, JSON.stringify({ schema: 'nori.learned-guidance.v2',
    knowledge: [{ text: entries[0].text, at: '2026-11-01T10:00:00.000Z' }, { text: entries[1].text, at: '2026-11-02T10:00:00.000Z' }],
    preferences: [], feedback: [] }))
  const url = new URL('../bridge/nori-learning.mjs', import.meta.url)
  url.searchParams.set('test', `${Date.now()}-${Math.random()}`)
  const memory = await import(url.href)
  const without = memory.learnedContext('what was that rice dish my grandmother cooked')
  assert.doesNotMatch(without, /gandules/, 'keyword matching alone misses it')
  const withCue = memory.learnedContext('what was that rice dish my grandmother cooked', { cued: [entries[0].text, 'Invented memory that was never saved.'] })
  assert.match(withCue, /Recalled by meaning[^]*gandules/)
  assert.doesNotMatch(withCue, /Invented memory/)
})

test('entry vectors persist across restarts and only for entries that still exist', async (t) => {
  const { mkdtempSync, rmSync, readFileSync } = await import('node:fs')
  const root = mkdtempSync(join(tmpdir(), 'nori-cue-disk-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const env = { ...environment, NORI_APP_DATA_ROOT: root }
  const load = async () => { const url = new URL('../bridge/semantic-memory.mjs', import.meta.url); url.searchParams.set('fresh', Math.random()); return import(url.href) }
  const first = await load()
  await first.cueRecall('warm', entries, { environment: env, fetcher: fakeWorker() }); await first.cueRecallWarming()
  const saved = JSON.parse(readFileSync(join(root, 'learning', 'cue-vectors.json'), 'utf8'))
  assert.equal(Object.keys(saved.vectors).length, 2)
  const second = await load()
  const calls = []
  const found = await second.cueRecall('what was that rice dish my grandmother made', entries, { environment: env, fetcher: fakeWorker(calls) })
  assert.deepEqual(found.map((match) => match.id), ['k1'], 'a restart recalls on the first message')
  assert.equal(calls.length, 1, 'only the cue was embedded after restart')
  const third = await load()
  await third.cueRecall('warm', [entries[1]], { environment: env, fetcher: fakeWorker() })
  await third.cueRecallWarming()
  const after = await third.cueRecall('rice dish grandmother', [entries[1]], { environment: env, fetcher: fakeWorker() })
  assert.ok(!after.some((match) => match.id === 'k1'), 'a removed memory is not recalled from disk')
})

test('a removed memory also leaves the vector file, even when nothing new is embedded', async (t) => {
  const { mkdtempSync, rmSync, readFileSync } = await import('node:fs')
  const root = mkdtempSync(join(tmpdir(), 'nori-cue-forget-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const env = { ...environment, NORI_APP_DATA_ROOT: root }
  const load = async () => { const url = new URL('../bridge/semantic-memory.mjs', import.meta.url); url.searchParams.set('forget', Math.random()); return import(url.href) }
  const first = await load()
  await first.cueRecall('warm', entries, { environment: env, fetcher: fakeWorker() }); await first.cueRecallWarming()
  const file = join(root, 'learning', 'cue-vectors.json')
  assert.equal(Object.keys(JSON.parse(readFileSync(file, 'utf8')).vectors).length, 2)
  const second = await load()
  await second.cueRecall('anything', [entries[1]], { environment: env, fetcher: fakeWorker() })
  assert.equal(Object.keys(JSON.parse(readFileSync(file, 'utf8')).vectors).length, 1, 'the removed entry is gone from disk')
})
