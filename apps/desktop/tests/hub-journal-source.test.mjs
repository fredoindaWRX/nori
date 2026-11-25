import test from 'node:test'
import assert from 'node:assert/strict'
import { hubSearch, hubUpload, hubReachable, hubBlock } from '../bridge/nori-hub.mjs'
import { saveJournalEntry } from '../bridge/nori-journal.mjs'

test('all hub operations reject external destinations before transport', async () => {
  let calls = 0
  const options = { url: 'https://example.com', fetcher: async () => { calls++ } }
  await assert.rejects(hubSearch('test', options), /loopback/)
  await assert.rejects(hubUpload({ content: 'A technical note for testing.' }, options), /loopback/)
  assert.equal(await hubReachable(options), false)
  assert.equal(calls, 0)
})

test('local hub calls refuse redirect following', async () => {
  const paths = []
  const fetcher = async (url, options) => {
    assert.equal(options.redirect, 'error')
    paths.push(new URL(url).pathname)
    return Response.json({ success: true, data: [] })
  }
  await hubSearch('test', { fetcher })
  await hubUpload({ content: 'A technical note for testing.' }, { fetcher })
  assert.equal(await hubReachable({ fetcher }), true)
  assert.deepEqual(paths, ['/memory/search', '/memory/upload', '/health'])
})

test('unavailable hub produces no invented background notes', async () => {
  assert.equal(await hubBlock('test', { fetcher: async () => { throw Error('offline') } }), '')
})

test('journal writes target Nori page only and short answers write nothing', () => {
  const writes = [], dirs = []
  const options = { root: 'C:/synthetic-journal', now: new Date(2026, 10, 10, 12),
    append: (...args) => writes.push(args), mkdir: (...args) => dirs.push(args) }
  assert.equal(saveJournalEntry('short', options), null)
  assert.equal(writes.length, 0)
  const target = saveJournalEntry('This is a synthetic journal entry.', options)
  assert.match(target.replaceAll('\\', '/'), /synthetic-journal\/nori\/2026-11-10.md$/)
  assert.equal(writes.length, 1)
  assert.equal(dirs.length, 1)
})
