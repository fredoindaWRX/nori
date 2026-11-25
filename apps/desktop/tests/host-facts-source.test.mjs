import test from 'node:test'
import assert from 'node:assert/strict'
import { modelAnswer, weekdayAnswer } from '../bridge/host-facts.mjs'

test('model status reports observed backend and the owner-approved context policy', async () => {
  const answer = await modelAnswer({ fetcher: async () => Response.json({ data: [{ backend_profile: 'qwen3.5-9b', context_tokens: 65536 }] }) })
  assert.match(answer, /9B.*64K-token/)
  assert.match(answer, /at least 65,536/)
  assert.match(answer, /35B when it fits/)
  assert.doesNotMatch(answer, /drop to the Freedom|locally on your GPU/)
})

test('unknown or unsuccessful status cannot invent a loaded model', async () => {
  assert.match(await modelAnswer({ fetcher: async () => Response.json({ data: [] }) }), /didn't report/)
  assert.equal(await modelAnswer({ fetcher: async () => Response.json({ data: [{ backend_profile: 'invented' }] }, { status: 503 }) }), null)
  assert.equal(await modelAnswer({ fetcher: async () => { throw Error('offline') } }), null)
})

test('calendar host answer rejects invalid dates', () => {
  assert.match(weekdayAnswer('what day was November 10, 2026?'), /Tuesday/)
  assert.equal(weekdayAnswer('what day was February 30, 2026?'), null)
})
