import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { HARD_SUITE_SIZE, runSelfTest, scoreCase, selfTestHistory } from '../bridge/self-improvement.mjs'
import { createIdleSelfTester } from '../bridge/idle-self-test.mjs'

const HARD = JSON.parse(fs.readFileSync(new URL('../bridge/self-test-hard.json', import.meta.url), 'utf8'))

test('every hard question has a model answer that its own check accepts, and an obviously wrong one fails', () => {
  assert.equal(HARD.length, HARD_SUITE_SIZE); assert.ok(HARD.length >= 100)
  assert.equal(new Set(HARD.map(c => c.id)).size, HARD.length, 'ids are unique')
  for (const c of HARD) {
    assert.match(c.id, /^h-[a-z]\d+$/); assert.ok(typeof c.p === 'string' && c.p.length > 3 && typeof c.key === 'string', c.id)
    assert.deepEqual(scoreCase(c.check, c.key), [], `${c.id}: the key answer must pass`)
    assert.notDeepEqual(scoreCase(c.check, 'I am not sure about that one, sorry, here is a long reply that says nothing useful at all and keeps going for a while so it is certainly too long for the short ones and has no figures in it whatsoever, friend, only words upon words upon words that carry on and on without ever arriving anywhere in particular at all today.'), [], `${c.id}: a non-answer must fail`)
  }
  const cats = new Set(HARD.map(c => c.cat))
  for (const cat of ['math', 'reason', 'convert', 'format', 'instruct', 'tech', 'identity', 'judgment', 'write']) assert.ok(cats.has(cat), cat)
})

// A model service that answers every question with its key and makes the right tool call.
function service(answers = new Map(HARD.map(c => [c.p, c.key]))) {
  const calls = { 'h-x1': ['calculator', { expression: '48317*2906' }], 'h-x2': ['set_timer', { minutes: 90, label: 'pizza' }], 'h-x4': ['read_file', { path: 'C:\\Users\\Studio\\Desktop\\notes.md' }],
    'h-x5': ['web_search', { query: 'Formula 1 race winner last weekend' }], 'h-x6': ['browser_navigate', { url: 'https://youtube.com' }], 'h-x7': ['save_memory', { fact: 'Prefers dark mode' }] }
  const byPrompt = [['48,317', 'h-x1'], ['pizza', 'h-x2'], ['notes.md', 'h-x4'], ['Formula 1', 'h-x5'], ['youtube.com', 'h-x6'], ['dark mode', 'h-x7']]
  return async (url, init) => {
    // App facts (exact maths, worked word problems, the do-not-invent fact) come before "[User request]".
    const body = JSON.parse(init.body), prompt = body.messages.at(-1).content.split('[User request]\n').at(-1)
    let message
    if (body.tools) { const hit = byPrompt.find(([needle]) => prompt.includes(needle)); message = hit ? { tool_calls: [{ function: { name: calls[hit[1]][0], arguments: JSON.stringify(calls[hit[1]][1]) } }] } : { content: 'Sure.' } }
    else message = { content: answers.get(prompt) ?? '?' }
    return { ok: true, json: async () => ({ choices: [{ message }] }), headers: { get: () => 'test-model' } }
  }
}

test('the hard suite runs every question, is saved as suite hard, and is only compared with other hard runs', async () => {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nori-hard-'))
  fs.mkdirSync(path.join(dataRoot, 'learning'))
  // An older standard full run must not be used as the comparison.
  fs.writeFileSync(path.join(dataRoot, 'learning', 'self-tests.jsonl'), JSON.stringify({ at: '2026-11-10T00:00:00Z', release: 'R1', models: ['test-model'], full: true, pass: 1, total: 92, avgSeconds: 1, byCat: {}, failed: [] }) + '\n')
  let out = ''
  for await (const piece of runSelfTest({ suite: 'hard', dataRoot, endpoint: 'http://x', fetcher: service() })) out += piece
  assert.match(out, /Running my hard self-test: \d+ checked questions and 8 tool-choice cases/)
  assert.match(out, new RegExp(`Hard self-test: ${HARD.length + 8}/${HARD.length + 8} \\(100%\\)`))
  assert.match(out, /first saved self-test of this size/)
  const saved = selfTestHistory(dataRoot).at(-1)
  assert.equal(saved.suite, 'hard'); assert.equal(saved.full, true); assert.equal(saved.total, HARD.length + 8); assert.deepEqual(saved.failed, [])
  // A second run, with every maths answer wrong, is compared with the first hard run.
  const wrong = new Map(HARD.map(c => [c.p, c.cat === 'math' ? 'no idea' : c.key]))
  out = ''
  for await (const piece of runSelfTest({ suite: 'hard', dataRoot, endpoint: 'http://x', fetcher: service(wrong) })) out += piece
  const maths = HARD.filter(c => c.cat === 'math').length
  assert.match(out, new RegExp(`Hard self-test: ${HARD.length + 8 - maths}/`)); assert.match(out, /below my last hard self-test/)
  assert.equal(selfTestHistory(dataRoot).at(-1).byCat.math.pass, 0)
  await assert.rejects(async () => { for await (const _ of runSelfTest({ suite: 'nonsense', dataRoot, fetcher: service() })) ; }, /Unknown self-test suite/)
  // The standard quick test is unchanged and carries no suite field.
  out = ''
  for await (const piece of runSelfTest({ dataRoot, endpoint: 'http://x', fetcher: service() })) out += piece
  assert.match(out, /Running my quick self-test: 29 checked questions and 7 tool-choice cases/)
  assert.equal(selfTestHistory(dataRoot).at(-1).suite, undefined)
})

test('when idle, the hard suite runs once a day per model in place of the quick one', async () => {
  const at = Date.parse('2026-11-18T10:00:00Z')
  const fetcher = async url => ({ ok: true, json: async () => (url.endsWith('/v1/models') ? { data: [{ backend_profile: 'm1', pending_requests: 0 }] } : { data: [] }) })
  const tick = async history => {
    const seen = []
    const tester = createIdleSelfTester({ dataRoot: 'C:/synthetic-unused', now: () => at, lastActivityAt: () => 0, settings: () => ({ enabled: true, idleMinutes: 30, everyHours: 24 }),
      history: () => history, fetcher, run: async function* (options) { seen.push(options.suite); yield 'done' } })
    return [await tester.tick(), seen]
  }
  const ago = hours => new Date(at - hours * 3_600_000).toISOString()
  assert.deepEqual(await tick([]), ['ran', ['hard']])
  // A quick run two hours ago does not put off the hard one.
  assert.deepEqual(await tick([{ at: ago(2), models: ['m1'], full: false }]), ['ran', ['hard']])
  // Hard done five hours ago on this model: nothing is due.
  assert.deepEqual(await tick([{ at: ago(5), models: ['m1'], full: true, suite: 'hard' }, { at: ago(4), models: ['m1'], full: false }]), ['fresh', []])
  // Hard done on this model, quick is older than a day: the quick one runs.
  assert.deepEqual(await tick([{ at: ago(5), models: ['m1'], full: true, suite: 'hard' }, { at: ago(30), models: ['m1'], full: false }]), ['ran', ['standard']])
  // Hard was run on another model a few minutes ago: wait before loading the card again.
  assert.deepEqual(await tick([{ at: ago(0.2), models: ['m2'], full: true, suite: 'hard' }]), ['cooldown', []])
})
