import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { experienceSignals, isRepeat, recordExperience, learningReport } from '../bridge/experience-journal.mjs'
import { requestsSelfReview, requestsSelfTest, runSelfTest, scoreCase, selfReview, selfTestHistory } from '../bridge/self-improvement.mjs'

const T0 = new Date('2026-11-07T15:00:00Z')
const later = minutes => new Date(T0.getTime() + minutes * 60000)

test('corrections and repeats are pinned on the previous reply; empty and slow replies are flagged', () => {
  const previous = { at: T0.toISOString(), request: 'what port does https use by default' }
  assert.deepEqual(experienceSignals({ request: "No, that's wrong", reply: 'Sorry, it is 443.', previous, now: later(2) }), ['corrects-previous'])
  assert.deepEqual(experienceSignals({ request: 'what port does https use by default?', reply: '443', previous, now: later(3) }), ['repeats-previous'])
  assert.deepEqual(experienceSignals({ request: "No, that's wrong", reply: 'ok', previous, now: later(90) }), [], 'too old to be about that reply')
  assert.deepEqual(experienceSignals({ request: 'hi', reply: '  ', seconds: 75, previous: null, now: later(1) }), ['empty', 'slow'])
  assert.equal(isRepeat('write a haiku about rain', 'what port does https use'), false)
})

test('the journal stores time, model and signals, and the learning report counts them', () => {
  const root = mkdtempSync(join(tmpdir(), 'nori-journal-'))
  recordExperience(root, { request: 'What is the capital of Australia?', reply: 'Sydney.', seconds: 2.34, model: 'qwen3.6-35b', now: T0 })
  const second = recordExperience(root, { request: "That's wrong, it's Canberra", reply: 'You are right, Canberra.', seconds: 1.2, model: 'qwen3.6-35b', now: later(1) })
  assert.deepEqual(second.signals, ['corrects-previous'])
  recordExperience(root, { request: 'tell me a joke', reply: '', seconds: 80, now: later(2) })
  const lines = readFileSync(join(root, 'learning', 'experience.jsonl'), 'utf8').trim().split('\n').map(line => JSON.parse(line))
  assert.equal(lines[0].seconds, 2.3); assert.equal(lines[0].model, 'qwen3.6-35b'); assert.equal(lines[0].signals, undefined)
  assert.equal(lines[2].outcome, 'failed'); assert.deepEqual(lines[2].signals, ['empty', 'slow'])
  assert.match(learningReport(root, { now: later(5) }), /Beyond my own wording: 1x you corrected me; 1x a reply took over a minute; 1x a reply came back empty/)
})

test('self-test and self-review requests are recognized narrowly', () => {
  for (const q of ['run a self-test', 'Nori, run a full self test', 'test yourself', 'do a quick self-test']) assert.ok(requestsSelfTest(q), q)
  for (const q of ['review yourself', 'self-review please', 'how can you improve?', 'what should we fix about you']) assert.ok(requestsSelfReview(q), q)
  for (const q of ['run the tests in my project', 'write a self-test for my function', 'review my code', 'how can I improve my essay']) {
    assert.equal(requestsSelfTest(q), false, q); assert.equal(requestsSelfReview(q), false, q)
  }
})

test('answers are scored by code', () => {
  assert.deepEqual(scoreCase({ num: 391 }, 'It is 391.'), [])
  assert.deepEqual(scoreCase({ num: 391 }, '401'), ['want 391'])
  assert.deepEqual(scoreCase({ exactwords: 3 }, 'red green blue'), [])
  assert.ok(scoreCase({ json: ['a'] }, 'not json').includes('not valid JSON'))
})

test('a self-test runs through the model service, saves history and compares runs', async () => {
  const root = mkdtempSync(join(tmpdir(), 'nori-selftest-'))
  const requests = []
  const fetcher = async (url, init) => {
    const body = JSON.parse(init.body); requests.push(body)
    assert.equal(url, 'http://model.test/v1/chat/completions'); assert.equal(body.model, 'nori-auto')
    const message = body.tools ? { content: 'Hello!', tool_calls: [] } : { content: 'I am Nori. 391' }
    return { ok: true, headers: { get: () => 'qwen3.6-35b' }, json: async () => ({ choices: [{ message }] }) }
  }
  let text = ''
  for await (const piece of runSelfTest({ dataRoot: root, endpoint: 'http://model.test', fetcher, now: () => T0 })) text += piece
  assert.match(text, /Running my quick self-test: 29 checked questions and 7 tool-choice cases/)
  assert.match(text, /\*\*Self-test: \d+\/36 \(\d+%\)\*\* on qwen3\.6-35b/)
  assert.match(text, /first saved self-test/)
  assert.ok(requests.every(body => body.messages[0].role === 'system'))
  assert.equal(selfTestHistory(root).length, 1)
  for await (const piece of runSelfTest({ dataRoot: root, endpoint: 'http://model.test', fetcher, now: () => later(10) })) text = piece
  assert.match(text, /Last time: \d+\/36/)
  assert.equal(selfTestHistory(root).length, 2)
})

test('self-review turns records into proposals and saves them, changing nothing else', () => {
  const root = mkdtempSync(join(tmpdir(), 'nori-review-'))
  recordExperience(root, { request: 'What is the capital of Australia?', reply: 'Sydney.', now: T0 })
  recordExperience(root, { request: "That's wrong, it's Canberra", reply: 'Canberra, sorry.', now: later(1) })
  recordExperience(root, { request: 'Post this on my Facebook', reply: "I can't post on social media accounts.", now: later(2) })
  const report = selfReview(root, { now: later(10) })
  assert.match(report, /1\. Answers you corrected \(1\)/)
  assert.match(report, /you asked "What is the capital of Australia\?", I said "Sydney\."/)
  assert.match(report, /Wishlist: things I could not do \(1\)/)
  assert.match(report, /no self-test yet/)
  assert.match(report, /I do not change or install my own code; each fix needs your OK/)
  assert.ok(existsSync(join(root, 'learning', 'improvement-proposals.md')))
  const empty = mkdtempSync(join(tmpdir(), 'nori-review-empty-'))
  assert.match(selfReview(empty, { now: T0 }), /I found nothing to fix in my records/)
})
