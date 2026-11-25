// Loopback-only LM Studio API compatibility for the local Codex CLI. Nori
// remains the model owner; this relay exposes only model discovery and text
// inference, not a shell, filesystem, or Nori tool broker.
const http = require('node:http')
const { URL } = require('node:url')
const { importedModelProfile } = require('./imported-model-profile.cjs')

const CODEX_LOCAL_PROVIDER_PORT = 1234
const NORI_GPT_OSS_ENDPOINT = 'http://127.0.0.1:18788'
const MODEL_ID = 'gpt-oss-20b'
const MAX_REQUEST_BYTES = 1024 * 1024

function assertLoopbackEndpoint(value) {
  const url = new URL(value)
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || url.port !== '18788' ||
      url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('Nori local-agent provider must target its pinned literal loopback model endpoint')
  }
  return url
}

function sendJson(response, status, payload) {
  const body = Buffer.from(JSON.stringify(payload))
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8',
    'content-length': String(body.length), 'cache-control': 'no-store', connection: 'close' })
  response.end(body)
}

function isBoundedAgentPayload(payload, protocol, modelId = MODEL_ID) {
  importedModelProfile(modelId)
  if (!payload || typeof payload !== 'object' || Array.isArray(payload) || payload.model !== modelId) return false
  if (protocol === 'responses') {
    return (typeof payload.input === 'string' || Array.isArray(payload.input)) &&
      (!Array.isArray(payload.input) || payload.input.length <= 128)
  }
  return Array.isArray(payload.messages) && payload.messages.length <= 128
}

async function readBoundedJson(request, protocol, modelId) {
  const chunks = []
  let size = 0
  for await (const chunk of request) {
    size += chunk.length
    if (size > MAX_REQUEST_BYTES) throw Object.assign(new Error('request_too_large'), { status: 413 })
    chunks.push(chunk)
  }
  let payload
  try { payload = JSON.parse(Buffer.concat(chunks).toString('utf8')) } catch {
    throw Object.assign(new Error('invalid_json'), { status: 400 })
  }
  if (!isBoundedAgentPayload(payload, protocol, modelId)) {
    throw Object.assign(new Error('invalid_local_chat_request'), { status: 400 })
  }
  // Codex's own tool calls would bypass Nori's broker. This adapter is an
  // inference-only adviser: remove agent-provided tools and their selectors.
  delete payload.tools
  delete payload.tool_choice
  delete payload.parallel_tool_calls
  return Buffer.from(JSON.stringify(payload))
}

function startNoriLocalAgentProvider({
  modelId = MODEL_ID,
  listenPort = CODEX_LOCAL_PROVIDER_PORT,
  createServer = http.createServer,
  request = http.request,
} = {}) {
  importedModelProfile(modelId)
  if (!Number.isInteger(listenPort) || listenPort < 0 || listenPort > 65535) {
    throw new RangeError('invalid local-agent provider port')
  }
  const target = assertLoopbackEndpoint(NORI_GPT_OSS_ENDPOINT)
  const server = createServer(async (incoming, outgoing) => {
    const remoteAddress = incoming.socket.remoteAddress
    if (remoteAddress !== '127.0.0.1' && remoteAddress !== '::ffff:127.0.0.1') {
      return sendJson(outgoing, 403, { error: 'loopback_only' })
    }
    const isModelList = incoming.method === 'GET' && incoming.url === '/v1/models'
    const protocol = incoming.url === '/v1/responses' ? 'responses' : 'chat'
    const isInference = incoming.method === 'POST' &&
      (incoming.url === '/v1/responses' || incoming.url === '/v1/chat/completions')
    if (isModelList) {
      return sendJson(outgoing, 200, { object: 'list', data: [{ id: modelId, object: 'model', owned_by: 'nori' }] })
    }
    if (!isInference) return sendJson(outgoing, 404, { error: 'not_found' })

    let body
    try {
      body = await readBoundedJson(incoming, protocol, modelId)
    } catch (error) {
      return sendJson(outgoing, error.status || 400, { error: error.message })
    }
    const headers = { accept: incoming.headers.accept || 'application/json' }
    headers['content-type'] = 'application/json'
    const upstreamRequest = request({
      protocol: target.protocol,
      hostname: target.hostname,
      port: target.port,
      method: incoming.method,
      path: incoming.url,
      headers,
      timeout: 120_000,
    }, upstreamResponse => {
      outgoing.writeHead(upstreamResponse.statusCode || 502, {
        'cache-control': 'no-store',
        ...(upstreamResponse.headers['content-type'] ? { 'content-type': upstreamResponse.headers['content-type'] } : {}),
        ...(upstreamResponse.headers['content-length'] ? { 'content-length': upstreamResponse.headers['content-length'] } : {}),
        ...(upstreamResponse.headers['transfer-encoding'] ? { 'transfer-encoding': upstreamResponse.headers['transfer-encoding'] } : {}),
      })
      upstreamResponse.pipe(outgoing)
    })
    upstreamRequest.on('timeout', () => upstreamRequest.destroy(new Error('upstream_timeout')))
    upstreamRequest.on('error', () => {
      if (!outgoing.headersSent) sendJson(outgoing, 502, { error: 'nori_local_model_unavailable' })
      else outgoing.destroy()
    })
    outgoing.on('close', () => upstreamRequest.destroy())
    upstreamRequest.end(body)
  })
  server.requestTimeout = 30_000
  server.headersTimeout = 10_000
  server.maxHeadersCount = 32

  return new Promise((resolve, reject) => {
    const onError = error => reject(error)
    server.once('error', onError)
    server.listen(listenPort, '127.0.0.1', () => {
      server.removeListener('error', onError)
      const address = server.address()
      if (!address || typeof address === 'string' || address.address !== '127.0.0.1') {
        server.close(() => reject(new Error('local-agent provider failed loopback binding check')))
        return
      }
      resolve({ endpoint: `http://127.0.0.1:${address.port}/v1`, port: address.port,
        stop: () => new Promise((done, fail) => server.close(error => error ? fail(error) : done())) })
    })
  })
}

module.exports = { CODEX_LOCAL_PROVIDER_PORT, NORI_GPT_OSS_ENDPOINT, MODEL_ID,
  MAX_REQUEST_BYTES, assertLoopbackEndpoint, isBoundedAgentPayload, startNoriLocalAgentProvider }
