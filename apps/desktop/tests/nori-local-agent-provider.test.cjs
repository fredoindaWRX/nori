const test = require('node:test')
const assert = require('node:assert/strict')
const http = require('node:http')
const { CODEX_LOCAL_PROVIDER_PORT, MAX_REQUEST_BYTES, assertLoopbackEndpoint,
  startNoriLocalAgentProvider } = require('../desktop/nori-local-agent-provider.cjs')

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      server.removeListener('error', reject)
      resolve(server.address().port)
    })
  })
}

test('Codex local-provider port is the expected LM Studio-compatible loopback port', () => {
  assert.equal(CODEX_LOCAL_PROVIDER_PORT, 1234)
  assert.throws(() => assertLoopbackEndpoint('http://example.com:18788'), /literal loopback/)
  assert.throws(() => assertLoopbackEndpoint('https://127.0.0.1:18788'), /literal loopback/)
  assert.throws(() => assertLoopbackEndpoint('http://user@127.0.0.1:18788'), /literal loopback/)
})

test('relay binds loopback and forwards only Nori model list and inference routes', async t => {
  const receivedBodies = []
  const model = http.createServer((request, response) => {
    if (request.method === 'GET' && request.url === '/v1/models') {
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ data: [{ id: 'gpt-oss-20b' }] }))
      return
    }
    if (request.method === 'POST' && ['/v1/chat/completions', '/v1/responses'].includes(request.url)) {
      const chunks = []
      request.on('data', chunk => chunks.push(chunk))
      request.on('end', () => {
        receivedBodies.push(JSON.parse(Buffer.concat(chunks).toString()))
        response.writeHead(200, { 'content-type': 'application/json' })
        response.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'local proposal' } }] }))
      })
      return
    }
    response.writeHead(404).end()
  })
  const modelPort = await listen(model)
  t.after(() => new Promise(resolve => model.close(resolve)))

  const relay = await startNoriLocalAgentProvider({ listenPort: 0,
    request: (options, callback) => http.request({ ...options, port: modelPort }, callback) })
  t.after(() => relay.stop())
  assert.match(relay.endpoint, /^http:\/\/127\.0\.0\.1:\d+\/v1$/)
  const listed = await fetch(`${relay.endpoint}/models`)
  assert.equal(listed.status, 200)
  assert.equal((await listed.json()).data[0].id, 'gpt-oss-20b')

  const generated = await fetch(`${relay.endpoint}/chat/completions`, {
    method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer not-forwarded' },
    body: JSON.stringify({ model: 'gpt-oss-20b', messages: [{ role: 'user', content: 'synthetic' }],
      tools: [{ type: 'function', function: { name: 'run_shell' } }], tool_choice: 'auto', parallel_tool_calls: true }),
  })
  assert.equal(generated.status, 200)
  assert.equal((await generated.json()).choices[0].message.content, 'local proposal')
  assert.deepEqual(receivedBodies[0], { model: 'gpt-oss-20b', messages: [{ role: 'user', content: 'synthetic' }] })

  const responseApi = await fetch(`${relay.endpoint}/responses`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model: 'gpt-oss-20b', input: 'synthetic Codex request',
      tools: [{ type: 'function', name: 'shell' }], tool_choice: 'auto', parallel_tool_calls: true }),
  })
  assert.equal(responseApi.status, 200)
  assert.deepEqual(receivedBodies[1], { model: 'gpt-oss-20b', input: 'synthetic Codex request' })
  assert.equal((await fetch(`${relay.endpoint}/files`, { method: 'POST' })).status, 404)
})

test('relay rejects malformed, oversized, and wrong-model inference without forwarding', async t => {
  let forwarded = 0
  const model = http.createServer((_request, response) => { forwarded++; response.writeHead(200).end('{}') })
  const modelPort = await listen(model)
  t.after(() => new Promise(resolve => model.close(resolve)))
  const relay = await startNoriLocalAgentProvider({ listenPort: 0,
    request: (options, callback) => http.request({ ...options, port: modelPort }, callback) })
  t.after(() => relay.stop())

  const send = body => fetch(`${relay.endpoint}/chat/completions`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body,
  })
  assert.equal((await send('{')).status, 400)
  assert.equal((await send(JSON.stringify({ model: 'wrong-model', messages: [] }))).status, 400)
  assert.equal((await send(JSON.stringify({ model: 'gpt-oss-20b', messages: [], padding: 'x'.repeat(MAX_REQUEST_BYTES) }))).status, 413)
  assert.equal(forwarded, 0)
})
