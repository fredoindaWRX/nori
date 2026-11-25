import test from 'node:test'
import assert from 'node:assert/strict'
import { guidedResearch } from '../bridge/research-tools.mjs'

test('guided lookup uses guarded tool calls and cites only readable pages', async () => {
  const calls = []
  const tools = { async call(name, args) {
    calls.push({ name, args })
    if (name === 'search_public_web') return JSON.stringify({ result: { urls: ['https://example.test/failed', 'https://example.test/a', 'https://example.test/b', 'https://example.test/c'] } })
    if (name === 'read_public_page') {
      if (args.url.endsWith('failed')) throw Error('denied')
      return JSON.stringify({ result: { url: args.url, text: 'observed page text' } })
    }
    return '{}'
  } }
  const answer = await guidedResearch(tools, '  test   question  ')
  assert.match(answer, /Source: https:\/\/example.test\/a/)
  assert.match(answer, /Source: https:\/\/example.test\/b/)
  assert.doesNotMatch(answer, /failed|example.test\/c/)
  assert.deepEqual(calls.at(-1), { name: 'build_research_report', args: { question: 'test question', urls: ['https://example.test/a', 'https://example.test/b'] } })
})

test('no readable source fails rather than inventing a report', async () => {
  let reports = 0
  const tools = { async call(name) {
    if (name === 'search_public_web') return JSON.stringify({ result: { urls: ['https://example.test/a'] } })
    if (name === 'build_research_report') reports++
    throw Error('unavailable')
  } }
  await assert.rejects(guidedResearch(tools, 'question'), /no source page/)
  assert.equal(reports, 0)
})
