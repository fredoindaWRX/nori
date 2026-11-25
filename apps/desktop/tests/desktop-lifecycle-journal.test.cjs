'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { createDesktopLifecycleJournal, resolveDesktopJournalRoot, LIFECYCLE_EVENTS } = require('../desktop/desktop-lifecycle-journal.cjs')

test('packaged app falls back to the canonical Nori root when its bundle omits the journal runtime', () => {
  const files = new Set(['C:\\Nori\\python\\Python311\\python.exe', 'C:\\Nori\\tools\\project_journal.py'])
  const exists = path => files.has(path)
  assert.equal(resolveDesktopJournalRoot('C:\\Installed\\NoriSuite', 'C:\\Nori', exists), 'C:\\Nori')
  files.add('C:\\Installed\\NoriSuite\\python\\Python311\\python.exe')
  files.add('C:\\Installed\\NoriSuite\\tools\\project_journal.py')
  assert.equal(resolveDesktopJournalRoot('C:\\Installed\\NoriSuite', 'C:\\Nori', exists), 'C:\\Installed\\NoriSuite')
})

test('lifecycle events write only fixed privacy-safe project journal entries', () => {
  const calls = []
  const journal = createDesktopLifecycleJournal('C:\\Nori', { spawnSync: (...args) => {
    calls.push(args)
    return { status: 0, stdout: '{}\n' }
  } })
  for (const event of LIFECYCLE_EVENTS) {
    const details = event === 'failure' ? { runtime: 'gpt-oss', packaged: true, code: 'renderer-load-failed' }
      : event === 'session-ended' ? { runtime: 'gpt-oss', packaged: true, outcome: 'failed' }
        : { runtime: 'gpt-oss', packaged: true }
    assert.deepEqual(journal.record(event, details), { recorded: true, reason: 'recorded' })
  }
  assert.equal(calls.length, LIFECYCLE_EVENTS.length)
  for (const [executable, args, options] of calls) {
    assert.equal(executable, 'C:\\Nori\\python\\Python311\\python.exe')
    assert.equal(args[0], '-B')
    assert.equal(args[1], 'C:\\Nori\\tools\\project_journal.py')
    assert.equal(args.at(-2), '--evidence')
    assert.equal(args.at(-1), 'apps/desktop/desktop/main.cjs')
    assert.equal(options.shell, false)
    assert.equal(options.timeout, 5000)
    assert.doesNotMatch(args.join(' '), /prompt|transcript|secret|token=/i)
  }
})

test('lifecycle logger rejects unknown fields, modes, events and unbounded failure codes', () => {
  const journal = createDesktopLifecycleJournal('C:\\Nori', { spawnSync: () => { throw Error('must not run') } })
  assert.equal(journal.record('prompt-text', {}).reason, 'invalid-event')
  assert.equal(journal.record('app-ready', { runtime: 'ollama' }).reason, 'invalid-event')
  assert.equal(journal.record('failure', { code: 'private prompt text' }).reason, 'invalid-details')
  assert.equal(journal.record('session-ended', { outcome: 'maybe' }).reason, 'invalid-details')
})

test('journal failure is non-fatal and does not expose process error details', () => {
  const journal = createDesktopLifecycleJournal('C:\\Nori', { spawnSync: () => { throw Error('private path content') } })
  assert.deepEqual(journal.record('app-ready'), { recorded: false, reason: 'journal-unavailable' })
})
