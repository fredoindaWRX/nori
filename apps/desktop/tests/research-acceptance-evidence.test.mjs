import test from 'node:test'
import assert from 'node:assert/strict'
import { evaluateResearchAcceptance } from '../scripts/research-acceptance-evidence.mjs'
const id = 'a'.repeat(32)
const complete = () => ({ task_id: id, status: 'completed', completion_kind: 'source_linked_research', response: 'Start at the tutorial.',
  executions: ['search_web', 'inspect_web', 'research_report'].map(action => ({ action, status: 'completed' })),
  research_evidence: [{ source: 'https://docs.python.org/3/' }] })
test('queued or running research cannot pass as completed', () => {
  for (const status of ['queued', 'running']) assert.deepEqual(evaluateResearchAcceptance({ task_id: id, status }, { taskId: id }), { passed: false, status: 'pending' })
})
test('failed task preserves failure rather than accepting the chat acknowledgement', () => {
  const result = evaluateResearchAcceptance({ task_id: id, status: 'failed', failure: { code: 'report_source_mismatch' } }, { taskId: id })
  assert.equal(result.passed, false); assert.equal(result.failure.code, 'report_source_mismatch')
})
test('only the exact completed source-linked task passes', () => {
  assert.equal(evaluateResearchAcceptance(complete(), { taskId: id }).passed, true)
  assert.equal(evaluateResearchAcceptance(complete(), { taskId: 'b'.repeat(32) }).passed, false)
})
test('missing receipts and out-of-scope sources cannot pass', () => {
  const missing = complete(); missing.executions.pop()
  assert.equal(evaluateResearchAcceptance(missing, { taskId: id }).passed, false)
  const outside = complete(); outside.research_evidence[0].source = 'https://example.com/'
  assert.equal(evaluateResearchAcceptance(outside, { taskId: id }).status, 'source-outside-scope')
})
