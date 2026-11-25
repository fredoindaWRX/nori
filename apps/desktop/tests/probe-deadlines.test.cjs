const test = require('node:test')
const assert = require('node:assert/strict')
const {readFileSync} = require('node:fs')
const {join} = require('node:path')

const deadlines = require('../scripts/probe-deadlines.cjs')
const source = join(__dirname, '../scripts/probe-desktop.mjs')
const packaged = join(__dirname, '../scripts/probe-packaged-consolidated.cjs')

test('packaged readiness probes allow the bounded cold-start interval and retain cleanup time', () => {
  assert.equal(deadlines.readinessMs, 120_000)
  assert.equal(deadlines.totalMs, 180_000)
  assert.equal(deadlines.cleanupMs, 40_000)
  assert.ok(deadlines.readinessMs > 90_000)
  assert.equal(deadlines.totalMs, deadlines.readinessMs + deadlines.cleanupMs + 20_000)
  assert.match(readFileSync(source, 'utf8'), /readinessMs:readinessTimeoutMs/)
  assert.match(readFileSync(source, 'utf8'), /Date\.now\(\)\+readinessTimeoutMs/)
  assert.match(readFileSync(packaged, 'utf8'), /Date\.now\(\) \+ READINESS_TIMEOUT_MS/)
})
