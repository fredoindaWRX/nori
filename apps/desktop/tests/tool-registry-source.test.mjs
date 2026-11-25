import test from 'node:test'
import assert from 'node:assert/strict'
import { composeToolUnion, toolArgsProblem, textualToolCall } from '../bridge/tool-registry.mjs'

const definition = name => ({ type: 'function', function: { name, parameters: {
  type: 'object', properties: { count: { type: 'integer', minimum: 1, maximum: 3 } },
  required: ['count'], additionalProperties: false,
} } })

test('close releases all distinct families after failure and prevents further dispatch', async () => {
  const closed = []
  const first = { definitions: [definition('first')], call: () => assert.fail('closed dispatch'),
    close() { closed.push('first'); throw Error('fixture close failure') } }
  const second = { definitions: [definition('second')], call: () => assert.fail('closed dispatch'),
    async close() { closed.push('second') } }
  const union = composeToolUnion([{ key: 'first', tools: first }, { key: 'duplicate', tools: first }, { key: 'second', tools: second }])
  const closing = union.close()
  assert.equal(union.close(), closing)
  await assert.rejects(closing, error => error instanceof AggregateError && error.errors.length === 1)
  assert.deepEqual(closed, ['first', 'second'])
  assert.deepEqual(union.definitions, [])
  await assert.rejects(union.call('first', {}), /nothing ran/)
})

test('union retains specialist ownership and delegates approval enforcement', async () => {
  let baseCalls = 0
  const union = composeToolUnion([
    { key: 'specialist', tools: { definitions: [definition('read_my_file')], call() { throw new Error('approval required') } } },
    { key: 'base', base: true, tools: { definitions: [definition('read_my_file'), definition('search_public_web')], call() { baseCalls++ } } },
  ], { maxTools: 1 })
  assert.deepEqual(union.definitions.map(x => x.function.name), ['read_my_file'])
  assert.equal(union.ownerOf('read_my_file'), 'specialist')
  await assert.rejects(union.call('read_my_file', {}), /approval required/)
  await assert.rejects(union.call('search_public_web', {}), /nothing ran/)
  assert.equal(baseCalls, 0)
})

test('catalog rechecks state-dependent tools before dispatch', async () => {
  let available = true, calls = 0
  const union = composeToolUnion([{ key: 'research', tools: {
    get definitions() { return available ? [definition('read_public_page')] : [] },
    call() { calls++ },
  } }])
  assert.equal(union.definitions.length, 1)
  available = false
  await assert.rejects(union.call('read_public_page', {}), /nothing ran/)
  assert.equal(calls, 0)
})

test('recovered textual calls still require schema checks and offered names', () => {
  const d = definition('inspect')
  const recovered = textualToolCall('<tool_call><function=inspect><parameter=count>9</parameter></function></tool_call>', [d])
  assert.deepEqual(recovered, { name: 'inspect', args: { count: 9 } })
  assert.match(toolArgsProblem(d, recovered.args), /above 3/)
  assert.match(toolArgsProblem(d, {}), /missing required/)
  assert.match(toolArgsProblem(d, { count: 1, shell: 'anything' }), /unknown field/)
  assert.equal(toolArgsProblem(d, { count: 2 }), null)
  assert.equal(textualToolCall('{"name":"unavailable","arguments":{}}', [d]), null)
  assert.equal(textualToolCall('Ordinary conversation', [d]), null)
})
