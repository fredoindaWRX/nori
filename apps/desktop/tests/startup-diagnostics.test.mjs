import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { formatStartupFailure, writeStartupFailure } = require('../desktop/startup-diagnostics.cjs')

test('startup diagnostics retain a useful error and stack without growing unbounded', () => {
  const error = new Error('Could not rebase Python runtime')
  const detail = formatStartupFailure(error, '2026-09-28T12:00:00.000Z')
  assert.match(detail, /2026-09-28T12:00:00\.000Z/)
  assert.match(detail, /Could not rebase Python runtime/)
  assert.match(detail, /startup-diagnostics\.test\.mjs/)
  assert.ok(detail.length <= 8192)
})

test('startup diagnostics are saved under the supplied user-writable location', () => {
  const root = mkdtempSync(join(tmpdir(), 'nori-startup-diagnostics-'))
  const logPath = join(root, 'runtime', 'startup-error.log')
  const result = writeStartupFailure(logPath, new Error('Bridge did not become ready.'))
  const contents = readFileSync(logPath, 'utf8')
  assert.equal(result, logPath)
  assert.match(contents, /Bridge did not become ready\./)
})
