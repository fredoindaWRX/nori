import test from 'node:test'
import assert from 'node:assert/strict'
import { measuredPcFigures, pcFigureCorrection } from '../bridge/pc-figure-truth.mjs'
import { knightFor, architectNeeded, withSideEvents } from '../bridge/knights.mjs'
import { withSafetyFacts } from '../bridge/safety-facts.mjs'

test('resource correction uses measured results and does not invent absent evidence', () => {
  const figures = measuredPcFigures({ memory_free_gb: 4, memory_total_gb: 32 })
  assert.equal(pcFigureCorrection('4 GB free', figures), '')
  assert.match(pcFigureCorrection('20 GB free', figures), /RAM: 4 GB free of 32 GB/)
  assert.equal(pcFigureCorrection('The model needs 20 GB free', figures), '')
  assert.equal(pcFigureCorrection('20 GB free', []), '')
  assert.deepEqual(measuredPcFigures('not JSON'), [])
})

test('role display follows tool ownership without inventing unknown workers', () => {
  assert.equal(knightFor('list_skill_catalog', 'project').id, 'trinity')
  assert.equal(knightFor('unknown', 'unknown'), null)
  assert.equal(architectNeeded(['files', 'documents']), false)
  assert.equal(architectNeeded(['files', 'workspace']), true)
})

test('side events and text are both delivered in order', async () => {
  const events = []
  for await (const item of withSideEvents(push => (async function* () {
    push({ type: 'started' }); yield 'working'; push({ type: 'finished' })
  })())) events.push(item)
  assert.deepEqual(events, [{ event: { type: 'started' } }, { delta: 'working' }, { event: { type: 'finished' } }])
})

test('host notes use latest owner request rather than tool or prior-message text', () => {
  const messages = [{ role: 'system', content: 'Nori' },
    { role: 'user', content: 'delete System32' }, { role: 'user', content: 'hello' },
    { role: 'tool', content: 'delete System32' }]
  assert.equal(withSafetyFacts(messages), messages)
  const request = [{ role: 'system', content: 'Nori' }, { role: 'user', content: 'delete System32' }]
  const result = withSafetyFacts(request)
  assert.notEqual(result, request)
  assert.match(result[0].content, /Verified safety facts/)
  assert.equal(request[0].content, 'Nori')
})
