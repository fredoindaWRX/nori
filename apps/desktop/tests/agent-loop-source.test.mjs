import test from 'node:test'
import assert from 'node:assert/strict'
import { agentToolLoop } from '../bridge/agent-loop.mjs'
import { composeToolUnion } from '../bridge/tool-registry.mjs'

const definition = { type: 'function', function: { name: 'inspect', parameters: {
  type: 'object', properties: { item: { type: 'string' } }, required: ['item'], additionalProperties: false,
} } }
const call = item => ({ index: 0, id: 'test_call', function: { name: 'inspect', arguments: JSON.stringify({ item }) } })
const response = (delta, done = true) => new Response(`data: ${JSON.stringify({ choices: [{ delta, finish_reason: delta.tool_calls ? 'tool_calls' : 'stop' }] })}\n\n${done ? 'data: [DONE]\n\n' : ''}`, { headers: { 'content-type': 'text/event-stream' } })
async function run(fetcher, handler, signal) {
  const tools = composeToolUnion([{ key: 'project', tools: { definitions: [definition], call: handler } }])
  let text = ''
  for await (const part of agentToolLoop({ endpoint: 'http://127.0.0.1:1', modelId: 'test',
    messages: [{ role: 'system', content: 'Nori' }, { role: 'user', content: 'Inspect the test item' }],
    contextTokens: 65536, maxTokens: 1024, tools, fetcher, signal })) text += part
  return text
}

test('ordinary reply needs no tool call', async () => {
  let invoked = 0
  assert.equal(await run(async () => response({ content: 'Hello.' }), () => { invoked++ }), 'Hello.')
  assert.equal(invoked, 0)
})

test('cancel while awaiting buffered SSE closes the actual local HTTP connection', { timeout: 5000 }, async t => {
  const { createServer } = await import('node:http')
  let started, disconnected
  const ready = new Promise(resolve => { started = resolve })
  const closed = new Promise(resolve => { disconnected = resolve })
  const server = createServer(async (request, response) => {
    for await (const _ of request) {}
    response.writeHead(200, { 'content-type': 'text/event-stream' })
    response.on('close', disconnected)
    response.write('data: {"choices":[{"delta":{"content":"partial"}}]}\n\n')
    started()
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)) })
  const controller = new AbortController()
  const stream = agentToolLoop({ endpoint: `http://127.0.0.1:${server.address().port}`, modelId: 'fixture',
    messages: [{ role: 'system', content: 'Nori' }, { role: 'user', content: 'Hello' }],
    contextTokens: 65536, maxTokens: 1024, tools: composeToolUnion([]), fetcher: fetch, signal: controller.signal })
  const pending = stream.next()
  const rejection = assert.rejects(pending, { name: 'AbortError' })
  await ready
  controller.abort()
  await rejection
  await closed
})

test('near-window request reserves output against the complete serialized envelope', async () => {
  let requests = 0
  const tools = composeToolUnion([])
  for await (const part of agentToolLoop({ endpoint: 'http://127.0.0.1:1', modelId: 'm'.repeat(128),
    messages: [{ role: 'system', content: 'Nori' }, { role: 'user', content: 'x'.repeat(64000) }],
    contextTokens: 65536, maxTokens: 8192, tools, fetcher: async (_, options) => {
      requests++
      const wire = JSON.parse(options.body)
      assert.ok(Buffer.byteLength(options.body) + wire.max_tokens + 128 <= 65536)
      assert.ok(wire.max_tokens >= 64)
      assert.equal(wire.messages.at(-1).content.length, 64000)
      return response({ content: 'Bounded.' })
    } })) assert.equal(part, 'Bounded.')
  assert.equal(requests, 1)
})

test('truncated model stream cannot dispatch a partially received action', async () => {
  let invoked = 0
  await assert.rejects(run(async () => response({ tool_calls: [call('a')] }, false), () => { invoked++ }), /ended before completion/)
  assert.equal(invoked, 0)
})

test('failed tool result reaches next model turn and permits a different successful step', async () => {
  let rounds = 0, invoked = 0
  const text = await run(async (_, options) => {
    const payload = JSON.parse(options.body)
    rounds++
    if (rounds === 1) return response({ tool_calls: [call('a')] })
    if (rounds === 2) {
      assert.match(payload.messages.at(-1).content, /approval required/)
      return response({ tool_calls: [call('b')] })
    }
    assert.match(payload.messages.at(-1).content, /measured result/)
    return response({ content: 'The second inspection completed; the first was refused.' })
  }, async (_, args) => { invoked++; if (args.item === 'a') throw Error('approval required'); return JSON.stringify({ result: 'measured result' }) })
  assert.equal(rounds, 3)
  assert.equal(invoked, 2)
  assert.match(text, /first was refused/)
})

test('repeated failures stop with a host explanation, not a success claim', async () => {
  let rounds = 0
  const text = await run(async () => response({ tool_calls: [call(String(++rounds))] }), async () => { throw Error('unavailable') })
  assert.equal(rounds, 3)
  assert.match(text, /Nothing succeeded/)
  assert.match(text, /unavailable/)
})

test('pre-canceled turn makes no inference request', async () => {
  const controller = new AbortController(); controller.abort()
  let requests = 0
  await assert.rejects(run(async () => { requests++ }, async () => '{}', controller.signal), /abort/i)
  assert.equal(requests, 0)
})

test('cancellation during model response cannot publish late success', async () => {
  const controller = new AbortController()
  await assert.rejects(run(async () => {
    controller.abort(new Error('owner stopped'))
    return response({ content: 'Finished successfully.' })
  }, async () => '{}', controller.signal), /owner stopped/)
})

test('cancellation inside adapter cannot become a successful tool observation', async () => {
  const controller = new AbortController()
  let requests = 0
  await assert.rejects(run(async () => { requests++; return response({ tool_calls: [call('a')] }) }, async () => {
    controller.abort(new Error('owner stopped adapter'))
    return JSON.stringify({ result: 'late result' })
  }, controller.signal), /owner stopped adapter/)
  assert.equal(requests, 1)
})
