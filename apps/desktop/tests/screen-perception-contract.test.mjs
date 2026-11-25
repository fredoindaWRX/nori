import test from 'node:test'
import assert from 'node:assert/strict'
import {
  parseScreenPerceptionJson,
  validateScreenPerceptionRequest,
  validateScreenPerceptionResponse,
} from '../bridge/screen-perception-contract.mjs'
import { perceiveScreenRequest } from '../bridge/screen-perception.mjs'
import {
  nativeRuntimeMode,
  resolveScreenVisionConfig,
  structuredScreenCapability,
  structuredScreenRequestBody,
} from '../bridge/local-chat.mjs'

const now = 100_000
const request = {
  type: 'screen-perception-frame',
  id: 'rpc-1',
  sampleId: 'vision-frame-7',
  source: 'screen',
  capturedAt: now - 250,
  frame: { data: 'aGVsbG8=', mimeType: 'image/jpeg' },
}
const response = (patch = {}) => ({
  schemaVersion: 1,
  requestId: 'rpc-1',
  sampleId: 'vision-frame-7',
  source: 'screen',
  capturedAt: request.capturedAt,
  observedAt: now - 50,
  status: 'ok',
  findings: [{ kind: 'application', value: 'Visual Studio Code' }],
  backendId: 'ollama-json-screen-v1',
  modelId: 'qwen3.5:4b',
  ...patch,
})
const expected = {
  requestId: request.id,
  sampleId: request.sampleId,
  capturedAt: request.capturedAt,
  now,
}

test('accepts a complete, correlated structured screen response', () => {
  const result = validateScreenPerceptionResponse(response(), expected)
  assert.equal(result.ok, true)
  assert.equal(result.response.findings[0].kind, 'application')
})

test('rejects requestId mismatch', () => {
  assert.equal(validateScreenPerceptionResponse(response({ requestId: 'other' }), expected).ok, false)
})

test('rejects sampleId mismatch', () => {
  assert.equal(validateScreenPerceptionResponse(response({ sampleId: 'other' }), expected).ok, false)
})

test('rejects capturedAt mismatch', () => {
  assert.equal(validateScreenPerceptionResponse(response({ capturedAt: request.capturedAt - 1 }), expected).ok, false)
})

test('rejects a source other than screen', () => {
  assert.equal(validateScreenPerceptionResponse(response({ source: 'camera' }), expected).ok, false)
})

test('rejects invalid, stale, future, and pre-capture timestamps', () => {
  for (const observedAt of [NaN, Infinity, now - 30_001, now + 5_001, request.capturedAt - 1]) {
    assert.equal(validateScreenPerceptionResponse(response({ observedAt }), expected).ok, false)
  }
})

test('rejects unknown finding types', () => {
  assert.equal(validateScreenPerceptionResponse(response({
    findings: [{ kind: 'person_detected', value: 'A person' }],
  }), expected).ok, false)
})

test('rejects blank and oversized finding values', () => {
  for (const value of ['  ', 'x'.repeat(1_001)]) {
    assert.equal(validateScreenPerceptionResponse(response({
      findings: [{ kind: 'visible_text', value }],
    }), expected).ok, false)
  }
})

test('preserves an optional validated confidence value', () => {
  const result = validateScreenPerceptionResponse(response({
    findings: [{ kind: 'application', value: 'Editor', confidence: 0.8 }],
  }), expected)
  assert.equal(result.ok, true)
  assert.equal(result.response.findings[0].confidence, 0.8)
})

test('rejects confidence outside its validated range', () => {
  assert.equal(validateScreenPerceptionResponse(response({
    findings: [{ kind: 'application', value: 'Editor', confidence: 1.01 }],
  }), expected).ok, false)
})

test('strict parser rejects malformed JSON', () => {
  assert.equal(parseScreenPerceptionJson('{bad', expected).ok, false)
})

test('strict parser rejects free-form model prose', () => {
  assert.equal(parseScreenPerceptionJson('I see Visual Studio Code.', expected).ok, false)
})

test('strict parser rejects legacy ALERT prose', () => {
  assert.equal(parseScreenPerceptionJson('ALERT: Visual Studio Code is open.', expected).ok, false)
})

test('strict parser rejects Markdown-wrapped JSON', () => {
  assert.equal(parseScreenPerceptionJson('```json\n{}\n```', expected).ok, false)
})

test('accepts a valid no_findings result', () => {
  const result = validateScreenPerceptionResponse(response({
    status: 'no_findings',
    findings: [],
  }), expected)
  assert.equal(result.ok, true)
  assert.equal(result.response.findings.length, 0)
})

test('backend failure is a structured error with no trusted findings', async () => {
  const result = await perceiveScreenRequest(request, {
    now: () => now,
    analyze: async () => { throw new Error('private raw backend details') },
  })
  assert.equal(result.ok, true)
  assert.equal(result.response.status, 'error')
  assert.equal(result.response.findings.length, 0)
  assert.equal(result.response.errorCode, 'perception_unavailable')
})

test('valid model findings preserve the submitted sampleId and captured timestamp provenance', async () => {
  const result = await perceiveScreenRequest(request, {
    now: () => now,
    analyze: async ({ image, schema }) => {
      assert.equal(image, request.frame.data)
      assert.equal(schema.type, 'object')
      return {
        raw: JSON.stringify({
          status: 'ok',
          findings: [{ kind: 'window', value: 'Settings' }],
        }),
        modelId: 'qwen3.5:4b',
      }
    },
  })
  assert.equal(result.ok, true)
  assert.equal(result.response.sampleId, request.sampleId)
  assert.equal(result.response.requestId, request.id)
  assert.equal(result.response.source, 'screen')
  assert.equal(result.response.observedAt, now)
  assert.equal(result.response.findings[0].value, 'Settings')
})

test('invalid requests fail before the model is called', async () => {
  let called = false
  const result = await perceiveScreenRequest({ ...request, source: 'camera' }, {
    now: () => now,
    analyze: async () => { called = true; return { raw: '' } },
  })
  assert.equal(result.ok, false)
  assert.equal(called, false)
  assert.equal(validateScreenPerceptionRequest(request, { now }).ok, true)
})

test('Ollama request binds the submitted screenshot to the strict JSON schema', () => {
  const body = structuredScreenRequestBody(request.frame.data, 'test-vision')
  assert.equal(body.model, 'test-vision')
  assert.deepEqual(body.format, {
    type: 'object',
    additionalProperties: false,
    required: ['status', 'findings'],
    properties: {
      status: { type: 'string', enum: ['ok', 'no_findings'] },
      findings: {
        type: 'array',
        maxItems: 24,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['kind', 'value'],
          properties: {
            kind: { type: 'string', enum: ['application', 'window', 'ui_element', 'visible_text'] },
            value: { type: 'string', minLength: 1, maxLength: 1_000 },
            confidence: { type: 'number', minimum: 0, maximum: 1 },
          },
        },
      },
    },
  })
  assert.deepEqual(body.messages[1].images, [request.frame.data])
})

const visionEnvironment = (patch = {}) => ({
  NORI_VISION_BACKEND: 'auto',
  NORI_VISION_MODEL: 'qwen3-vl:8b-instruct',
  NORI_VISION_OLLAMA_URL: 'http://127.0.0.1:11434',
  ...patch,
})

function visionFetcher({
  installed = ['qwen3-vl:8b-instruct'],
  capabilities = ['vision'],
  schemaStatus = 200,
  schemaContent = '{"status":"no_findings","findings":[]}',
  calls = [],
} = {}) {
  const fetcher = async (url, init = {}) => {
    calls.push({ url, init, body: init.body ? JSON.parse(init.body) : null })
    if (url.endsWith('/api/tags')) {
      return new Response(JSON.stringify({ models: installed.map((name) => ({ name })) }), { status: 200 })
    }
    if (url.endsWith('/api/show')) {
      return new Response(JSON.stringify({ capabilities }), { status: 200 })
    }
    if (url.endsWith('/api/chat')) {
      return new Response(JSON.stringify({ message: { content: schemaContent } }), { status: schemaStatus })
    }
    throw new Error(`Unexpected Vision endpoint ${url}`)
  }
  return { fetcher, calls }
}

test('native main runtime and dedicated Ollama Vision backend remain independent', async () => {
  const environment = visionEnvironment({ NORI_INFERENCE_RUNTIME: 'norllama' })
  const { fetcher, calls } = visionFetcher()
  const capability = await structuredScreenCapability({ environment, fetcher })
  assert.equal(nativeRuntimeMode(environment), 'norllama')
  const schemaProbe = calls.find(({ url }) => url.endsWith('/api/chat'))
  assert.equal(schemaProbe.body.model, 'qwen3-vl:8b-instruct')
  assert.equal(schemaProbe.body.stream, false)
  assert.equal('images' in schemaProbe.body.messages[0], false)
  assert.deepEqual(capability, {
    available: true,
    backendId: 'ollama-json-screen-v1',
    modelId: 'qwen3-vl:8b-instruct',
    imageCapable: true,
    structuredOutput: true,
  })
})

test('retired main runtime is refused independently of the legacy Vision protocol fixture', async () => {
  const environment = visionEnvironment({
    NORI_INFERENCE_RUNTIME: 'ollama-rollback',
    NORI_DEFAULT_MODEL: 'qwen3.5:4b',
    NORI_VISION_MODEL: '',
  })
  const { fetcher, calls } = visionFetcher()
  const capability = await structuredScreenCapability({ environment, fetcher })
  assert.throws(() => nativeRuntimeMode(environment), /requires an explicitly supported local runtime/)
  assert.equal(capability.modelId, 'qwen3-vl:8b-instruct')
  assert.equal(calls.find(({ url }) => url.endsWith('/api/show')).body.model, 'qwen3-vl:8b-instruct')
})

test('Vision configuration defaults to auto and its dedicated installed model', () => {
  assert.deepEqual(resolveScreenVisionConfig({}), {
    backend: 'auto',
    modelId: 'qwen3-vl:8b-instruct',
    endpoint: 'http://127.0.0.1:11434',
  })
})

test('Vision disabled configuration fails closed', async () => {
  const result = await structuredScreenCapability({
    environment: visionEnvironment({ NORI_VISION_BACKEND: 'disabled' }),
    fetcher: async () => { throw new Error('must not contact Ollama') },
  })
  assert.equal(result.available, false)
  assert.equal(result.errorCode, 'vision_disabled')
})

test('unreachable dedicated Ollama fails closed without trying the chat runtime', async () => {
  const result = await structuredScreenCapability({
    environment: visionEnvironment({ NORI_INFERENCE_RUNTIME: 'norllama' }),
    fetcher: async () => { throw new Error('connection refused') },
  })
  assert.equal(result.available, false)
  assert.equal(result.errorCode, 'ollama_unreachable')
})

test('configured Vision model missing from Ollama fails closed', async () => {
  const { fetcher } = visionFetcher({ installed: ['qwen3.5:4b'] })
  const result = await structuredScreenCapability({ environment: visionEnvironment(), fetcher })
  assert.equal(result.available, false)
  assert.equal(result.errorCode, 'model_missing')
})

test('installed text-only Vision selection fails closed without fallback', async () => {
  const { fetcher, calls } = visionFetcher({ capabilities: ['completion', 'tools'] })
  const result = await structuredScreenCapability({ environment: visionEnvironment(), fetcher })
  assert.equal(result.available, false)
  assert.equal(result.errorCode, 'image_unsupported')
  assert.equal(calls.some(({ url }) => url.endsWith('/api/chat')), false)
})

test('schema support failure fails closed and never uses legacy alert scanning', async () => {
  const { fetcher, calls } = visionFetcher({ schemaStatus: 400 })
  const result = await structuredScreenCapability({ environment: visionEnvironment(), fetcher })
  assert.equal(result.available, false)
  assert.equal(result.errorCode, 'schema_unsupported')
  assert.equal(calls.some(({ url }) => url.endsWith('/screen-monitor-frame')), false)
})

test('schema endpoint accepting a non-contract response fails closed', async () => {
  const { fetcher } = visionFetcher({ schemaContent: 'ALERT: Visual Studio Code is open' })
  const result = await structuredScreenCapability({ environment: visionEnvironment(), fetcher })
  assert.equal(result.available, false)
  assert.equal(result.errorCode, 'schema_unsupported')
})

test('Vision request schema and image payload use only the configured Vision model', () => {
  const body = structuredScreenRequestBody(request.frame.data, 'configured-vision-model')
  assert.equal(body.model, 'configured-vision-model')
  assert.deepEqual(body.messages[1].images, [request.frame.data])
  assert.equal(body.format.type, 'object')
  assert.equal(body.format.additionalProperties, false)
  assert.deepEqual(body.format.required, ['status', 'findings'])
  assert.equal(body.options.num_ctx, 4096)
})
