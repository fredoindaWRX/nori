'use strict'

const { spawnSync: defaultSpawnSync } = require('node:child_process')
const { existsSync: defaultExistsSync } = require('node:fs')
const { join } = require('node:path')
const { FAILURE_CODES } = require('./desktop-session-outcome.cjs')

const EVENTS = Object.freeze({
  'app-ready': ['verify', 'desktop app reached Electron ready'],
  'boot-completed': ['verify', 'desktop startup sequence completed'],
  'renderer-loaded': ['verify', 'desktop renderer finished loading'],
  'shutdown-started': ['verify', 'desktop shutdown started'],
  failure: ['failure', 'desktop lifecycle reported a bounded failure'],
  'session-ended': ['verify', 'desktop session ended'],
})
const RUNTIMES = Object.freeze(['norllama', 'gpt-oss', 'remote', 'unknown'])
const OUTCOMES = Object.freeze(['clean', 'failed', 'cancelled', 'incomplete'])

function hasJournalRuntime(root, existsSync = defaultExistsSync) {
  return existsSync(join(root, 'python', 'Python311', 'python.exe')) &&
    existsSync(join(root, 'tools', 'project_journal.py'))
}

function resolveDesktopJournalRoot(suiteRoot, canonicalRoot, existsSync = defaultExistsSync) {
  if (typeof suiteRoot !== 'string' || !suiteRoot || typeof canonicalRoot !== 'string' || !canonicalRoot ||
      typeof existsSync !== 'function') throw Error('Invalid lifecycle journal roots')
  if (hasJournalRuntime(suiteRoot, existsSync)) return suiteRoot
  if (hasJournalRuntime(canonicalRoot, existsSync)) return canonicalRoot
  return suiteRoot
}

function createDesktopLifecycleJournal(root, { spawnSync = defaultSpawnSync } = {}) {
  if (typeof root !== 'string' || !root || typeof spawnSync !== 'function') throw Error('Invalid lifecycle journal setup')
  return Object.freeze({
    record(event, { runtime = 'unknown', packaged = false, code, outcome } = {}) {
      if (!Object.hasOwn(EVENTS, event) || !RUNTIMES.includes(runtime) || typeof packaged !== 'boolean') {
        return Object.freeze({ recorded: false, reason: 'invalid-event' })
      }
      if ((event === 'failure' && !FAILURE_CODES.includes(code)) || (event !== 'failure' && code !== undefined) ||
          (event === 'session-ended' ? !OUTCOMES.includes(outcome) : outcome !== undefined)) {
        return Object.freeze({ recorded: false, reason: 'invalid-details' })
      }
      const [kind, label] = EVENTS[event]
      const suffix = event === 'failure' ? ` code=${code}` : event === 'session-ended' ? ` outcome=${outcome}` : ''
      const summary = `${label}; runtime=${runtime}; packaged=${packaged}${suffix}`
      const python = join(root, 'python', 'Python311', 'python.exe')
      const script = join(root, 'tools', 'project_journal.py')
      try {
        const result = spawnSync(python, ['-B', script, '--kind', kind, '--summary', summary,
          '--evidence', 'apps/desktop/desktop/main.cjs'], {
          shell: false, windowsHide: true, encoding: 'utf8', timeout: 5000, maxBuffer: 65536,
        })
        if (result.error || result.status !== 0) return Object.freeze({ recorded: false, reason: 'journal-unavailable' })
        return Object.freeze({ recorded: true, reason: 'recorded' })
      } catch {
        return Object.freeze({ recorded: false, reason: 'journal-unavailable' })
      }
    },
  })
}

module.exports = { createDesktopLifecycleJournal, resolveDesktopJournalRoot,
  LIFECYCLE_EVENTS: Object.freeze(Object.keys(EVENTS)) }
