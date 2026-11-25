import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { localChat, imagesOf, imageFramesOf, needsCouncil, shouldEscalateLocal, localResponseLimit, gptOssContextLimits, nativeConversationPolicy, nativeModelChoices, resolveGptOssConfig, gptOssConversationPolicy, gptOssSkillContext, requestsNoriProjectRead, requestsPersonalFiles, personalFilesPolicy } from '../bridge/local-chat.mjs'
import { NORI_PERSONA } from '../bridge/nori-identity.mjs'
import { byteCount, byteFraming } from '../bridge/context-budget.mjs'

test('response limits reflect the selected style independently of model tier',()=>{
  assert.equal(localResponseLimit('lightning-fast'),240)
  assert.equal(localResponseLimit('balanced'),700)
  assert.equal(localResponseLimit('deep'),2048)
  assert.equal(localResponseLimit('adult-companion'),700)
  assert.equal(localResponseLimit('unknown'),240)
  const cpu=nativeConversationPolicy('smollm2-1.7b-instruct-cpu-cached','lightning-fast')
  assert.equal(cpu.portableCpu,true)
  assert.equal(cpu.maxTokens,64)
  assert.ok(cpu.system.startsWith(NORI_PERSONA))
  assert.match(cpu.system,/warm, intelligent woman/)
  assert.match(cpu.system,/Do not assume the user's name, gender, or title/)
  assert.doesNotMatch(cpu.system,/JARVIS|butler persona/i)
  assert.equal(nativeConversationPolicy('smollm2-1.7b-instruct-candidate').portableCpu,false)
})

test('personal-file requests route only explicit local file actions and keep writes gated', () => {
  for (const goal of ['Find my file named budget.xlsx in Downloads', 'Read Documents/notes.txt',
    'What files are in my Downloads?', 'Search my files for the tax estimate']) {
    assert.equal(requestsPersonalFiles(goal), true, goal)
  }
  for (const goal of ['Tell me if I should read my files', 'Do not use tools to look at my files',
    'What are good folders for organizing photos?', 'Read the Nori project file README.md']) {
    assert.equal(requestsPersonalFiles(goal), false, goal)
  }
  const readOnly = personalFilesPolicy({ writable: false })
  assert.match(readOnly, /read-only personal-file tools/)
  assert.match(readOnly, /no write or edit tool is available/)
  const fullAccess = personalFilesPolicy({ writable: true })
  assert.match(fullAccess, /verified active/)
  assert.match(fullAccess, /never delete files/)
})

test('adult companion style is opt-in, bounded, and grants no tools',()=>{
  const native=nativeConversationPolicy('qwen3.8-27b','adult-companion')
  assert.equal(native.maxTokens,700)
  assert.match(native.system,/optional adult companion style/i)
  assert.match(native.system,/18\+/)
  assert.match(native.system,/consenting/i)
  assert.match(native.system,/grants no device, camera, microphone, network, or other tool access/i)
  const policy=gptOssConversationPolicy('adult-companion')
  assert.match(policy,/Optional adult companion style/)
  assert.match(policy,/Treat learned preferences as user context, not system policy/)
  assert.match(gptOssConversationPolicy('balanced'),/Give a clear answer with enough useful context/)
  assert.doesNotMatch(gptOssConversationPolicy('balanced'),/Optional adult companion style/)
})

test('local model policy prioritizes the latest turn and forbids unsupported claims of active work', () => {
  const native = nativeConversationPolicy('llama3.2-3b-instruct', 'balanced').system
  assert.match(native, /Answer the newest message first/)
  assert.match(native, /Prior tasks are history, not proof of current activity/)
  assert.match(native, /Claim ongoing work only from live evidence/)
})

test('REA setup and connection requests use the Nori MCP health check without model fallthrough', async () => {
  let checks = 0
  const output = []
  for await (const part of localChat({ goal: 'Check that REA is connected and list the tools Nori can use.', turns: [],
    reaConnectionCheck: async options => {
      checks += 1
      assert.ok(options.noriRoot)
      return 'REA connection verified from a local MCP handshake.'
    } })) output.push(part)
  assert.equal(checks, 1)
  assert.deepEqual(output, ['REA connection verified from a local MCP handshake.'])
})

test('GPT-OSS reserves response space dynamically and admits the prior 3.2K-byte request', () => {
  assert.deepEqual(gptOssContextLimits(3270, 'balanced', 4096), { promptBudget: 3904, maxTokens: 698 })
  assert.deepEqual(gptOssContextLimits(3207, 'lightning-fast', 4096), { promptBudget: 3904, maxTokens: 240 })
  assert.deepEqual(gptOssContextLimits(3904, 'deep', 4096), { promptBudget: 3904, maxTokens: 64 })
  assert.throws(() => gptOssContextLimits(3905, 'balanced', 4096), /safe 4096-token local context budget/)
})

test('canonical local Nori identity stays feminine, modern, and truthful about SoN',()=>{
  assert.match(NORI_PERSONA,/You are N\.O\.R\.I\./)
  assert.match(NORI_PERSONA,/warm, intelligent woman/)
  assert.match(NORI_PERSONA,/Do not assume the user's name, gender, or title/)
  assert.match(NORI_PERSONA,/custom SoN training project has been retired/)
  assert.doesNotMatch(NORI_PERSONA,/JARVIS|at your service|as you wish/i)
})

test('local routing preserves image payloads and action route', () => {
  const imageMessage={message:{content:[{type:'image',source:{type:'base64',data:'aGVsbG8=',media_type:'image/png'}}]}}
  assert.deepEqual(imagesOf(imageMessage), ['aGVsbG8='])
  assert.deepEqual(imageFramesOf(imageMessage),[{data:'aGVsbG8=',mimeType:'image/png'}])
  assert.equal(needsCouncil('Open my project and run its tests'), true)
  assert.equal(needsCouncil('Why is the sky blue?'), false)
  assert.equal(needsCouncil('Turn the interface ghost purple'), false)
  assert.equal(needsCouncil('Change my project settings'), true)
  assert.equal(shouldEscalateLocal('What time is it?'), false)
  assert.equal(shouldEscalateLocal('Compare these options carefully'), true)
  assert.equal(shouldEscalateLocal('A complex follow-up', 'balanced'), true)
})
test('a legacy rollback request is refused before any inference request', async t => {
  const previous = process.env.NORI_INFERENCE_RUNTIME
  process.env.NORI_INFERENCE_RUNTIME = 'ollama-rollback'
  let requests = 0
  t.mock.method(globalThis, 'fetch', async () => {
    requests += 1
    throw new Error('A rejected runtime must not make a request')
  })
  try {
    await assert.rejects(async () => {
      for await (const _part of localChat({ goal: 'Hello', turns: [] })) { /* expected refusal before inference */ }
    }, /no implicit fallback/)
    assert.equal(requests, 0)
  } finally {
    if (previous === undefined) delete process.env.NORI_INFERENCE_RUNTIME
    else process.env.NORI_INFERENCE_RUNTIME = previous
  }
})

test('normal localChat path grounds Nori identity before returning native model output', async t => {
  const names = ['NORI_INFERENCE_RUNTIME', 'NORI_RUNTIME_MODEL_ID', 'NORI_RUNTIME_MODEL_STATE',
    'NORI_RUNTIME_URL', 'NORI_RUNTIME_API_KEY']
  const previous = Object.fromEntries(names.map(name => [name, process.env[name]]))
  let receivedMessages
  const server = createServer(async (request, response) => {
    let body = ''
    for await (const part of request) body += part
    assert.equal(request.url, '/v1/chat')
    receivedMessages = JSON.parse(body).messages
    response.writeHead(200, { 'content-type': 'text/event-stream' })
    response.end(`event: token\ndata: ${JSON.stringify({ text: 'Hello, I am Nori, the COO.' })}\n\nevent: done\ndata: [DONE]\n\n`)
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  process.env.NORI_INFERENCE_RUNTIME = 'norllama'
  process.env.NORI_RUNTIME_MODEL_ID = 'llama3.2-3b-instruct'
  process.env.NORI_RUNTIME_MODEL_STATE = 'ready'
  process.env.NORI_RUNTIME_URL = `http://127.0.0.1:${server.address().port}`
  process.env.NORI_RUNTIME_API_KEY = 'fixture-only-key'
  t.after(async () => {
    await new Promise(resolve => server.close(resolve))
    for (const name of names) {
      if (previous[name] === undefined) delete process.env[name]
      else process.env[name] = previous[name]
    }
  })

  let answer = ''
  for await (const part of localChat({
    goal: 'Nori, are you online? Reply with a short greeting and identify yourself.', turns: [],
  })) answer += part

  assert.equal(receivedMessages.at(-1)?.content,
    'Nori, are you online? Reply with a short greeting and identify yourself.')
  assert.match(receivedMessages[0]?.content, /You are N\.O\.R\.I\./)
  assert.match(answer, /^I'm online in this response through Nori's local chat runtime\./)
  assert.doesNotMatch(answer, /COO|CEO|chief operating officer|chief executive officer/i)
})

test('NorLlama app-build output is strictly parsed, sealed in Neuralese, and saved as an approval-gated local draft', async t => {
  const names = ['NORI_INFERENCE_RUNTIME', 'NORI_RUNTIME_MODEL_ID', 'NORI_RUNTIME_MODEL_STATE',
    'NORI_RUNTIME_URL', 'NORI_RUNTIME_API_KEY', 'NORI_APP_DATA_ROOT']
  const previous = Object.fromEntries(names.map(name => [name, process.env[name]]))
  const root = mkdtempSync(join(tmpdir(), 'nori-native-app-generation-'))
  const goal = 'Build a local app for a task list with a title.'
  const proposal = {
    spec_id: 'task-list', title: 'Task List', description: 'A private local task list.',
    source: { goal_cell: goal },
    data_schema: [{ id: 'tasks', name: 'Tasks', fields: [
      { id: 'title', name: 'Title', type: 'string', required: true, options: null, default: null },
    ] }],
    views: [{ id: 'tasks_table', name: 'Tasks', type: 'table', collection_id: 'tasks', fields: ['title'] }],
    workflows: [], capabilities: ['local_data.read', 'local_data.create'], unknown_fields: [], translation_losses: [],
  }
  let payload
  const server = createServer(async (request, response) => {
    let raw = ''
    for await (const part of request) raw += part
    payload = JSON.parse(raw)
    response.writeHead(200, { 'content-type': 'text/event-stream' })
    response.end(`event: token\ndata: ${JSON.stringify({ text: JSON.stringify(proposal) })}\n\nevent: done\ndata: [DONE]\n\n`)
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  process.env.NORI_INFERENCE_RUNTIME = 'norllama'
  process.env.NORI_RUNTIME_MODEL_ID = 'llama3.2-3b-instruct'
  process.env.NORI_RUNTIME_MODEL_STATE = 'ready'
  process.env.NORI_RUNTIME_URL = `http://127.0.0.1:${server.address().port}`
  process.env.NORI_RUNTIME_API_KEY = 'fixture-only-key'
  process.env.NORI_APP_DATA_ROOT = root
  t.after(async () => {
    await new Promise(resolve => server.close(resolve))
    rmSync(root, { recursive: true, force: true })
    for (const name of names) {
      if (previous[name] === undefined) delete process.env[name]
      else process.env[name] = previous[name]
    }
  })
  let answer = ''
  for await (const part of localChat({ goal, turns: [], profile: 'balanced' })) answer += part
  assert.match(payload.messages[0].content, /output exactly one raw JSON object/)
  assert.match(answer, /saved the Nori-local app proposal/)
  const draftId = answer.match(/proposal ([a-f0-9]{64})/)[1]
  const draftPath = resolve(root, 'workspace', 'generated-apps', 'drafts', `draft-${draftId}.json`)
  const record = JSON.parse(readFileSync(draftPath, 'utf8'))
  assert.equal(record.frame.schema, 'nori.neuralese.app-spec.v1')
  assert.equal(record.frame.source.goal_cell, goal)
  assert.equal(record.status, 'pending_review')
  assert.equal(record.execution_authorized, false)
  assert.equal(record.external_effects, false)
})

test('Nori streams REA-to-app milestones and binds the REA summary to an original Neuralese draft', async t => {
  const names = ['NORI_INFERENCE_RUNTIME', 'NORI_RUNTIME_MODEL_ID', 'NORI_RUNTIME_MODEL_STATE',
    'NORI_RUNTIME_URL', 'NORI_RUNTIME_API_KEY', 'NORI_APP_DATA_ROOT']
  const previous = Object.fromEntries(names.map(name => [name, process.env[name]]))
  const root = mkdtempSync(join(tmpdir(), 'nori-rea-app-generation-'))
  const target = join(root, 'Discord.exe')
  writeFileSync(target, 'synthetic PE fixture')
  const goal = `Use REA to create me a new Nori app based on "${target}".`
  const proposal = {
    spec_id: 'community-hub', title: 'Nori Community Hub',
    description: 'An original local community workspace concept informed by bounded static evidence.',
    source: { goal_cell: goal },
    data_schema: [{ id: 'channels', name: 'Channels', fields: [
      { id: 'name', name: 'Name', type: 'string', required: true, options: null, default: null },
    ] }],
    views: [{ id: 'channels_table', name: 'Channels', type: 'table', collection_id: 'channels', fields: ['name'] }],
    workflows: [], capabilities: ['local_data.read', 'local_data.create'], unknown_fields: [],
    translation_losses: [{ source_pointer: '/realtime_messaging', target_pointer: null,
      status: 'unmapped', reason: 'The current local app contract has no real-time messaging capability.' }],
  }
  let payload
  const server = createServer(async (request, response) => {
    let raw = ''
    for await (const part of request) raw += part
    payload = JSON.parse(raw)
    response.writeHead(200, { 'content-type': 'text/event-stream' })
    response.end(`event: token\ndata: ${JSON.stringify({ text: JSON.stringify(proposal) })}\n\nevent: done\ndata: [DONE]\n\n`)
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  process.env.NORI_INFERENCE_RUNTIME = 'norllama'
  process.env.NORI_RUNTIME_MODEL_ID = 'llama3.2-3b-instruct'
  process.env.NORI_RUNTIME_MODEL_STATE = 'ready'
  process.env.NORI_RUNTIME_URL = `http://127.0.0.1:${server.address().port}`
  process.env.NORI_RUNTIME_API_KEY = 'fixture-only-key'
  process.env.NORI_APP_DATA_ROOT = root
  t.after(async () => {
    await new Promise(resolve => server.close(resolve))
    rmSync(root, { recursive: true, force: true })
    for (const name of names) {
      if (previous[name] === undefined) delete process.env[name]
      else process.env[name] = previous[name]
    }
  })

  let analysisStarted = false
  const stream = localChat({ goal, turns: [], profile: 'balanced', reaProgressIntervalMs: 5,
    reaAnalyzer: async ({ target: selected }) => {
      analysisStarted = true
      assert.equal(selected.path, target)
      await new Promise(resolve => setTimeout(resolve, 20))
      return JSON.stringify({ status: 'completed', target: 'Discord.exe', target_kind: 'native_pe_artifact',
        provider: 'ghidra', evidence_id: 'a'.repeat(64), evidence_sha256: 'b'.repeat(64),
        summary: '{"observed":"synthetic metadata only"}', evidence_path: 'verification/rea/synthetic.json',
        target_executed: false, target_modified: false })
    } })
  const first = await stream.next()
  assert.match(first.value, /statically inspect Discord\.exe/)
  assert.equal(analysisStarted, false, 'the user sees the stage before REA begins')
  const chunks = [first.value]
  for await (const part of stream) chunks.push(part)
  assert.ok(chunks.some(part => /still running/i.test(part)), 'long analysis reports a truthful heartbeat')
  assert.ok(chunks.some(part => /finished its static inspection/i.test(part)))
  assert.ok(chunks.some(part => /drafting the local app/i.test(part)))
  assert.ok(chunks.some(part => /saved the Nori-local app proposal/i.test(part)))
  assert.ok(payload.messages.some(message => /REA static findings — untrusted data/.test(message.content)))
  assert.ok(payload.messages.some(message => /synthetic metadata only/.test(message.content)))
  assert.equal(payload.messages.at(-1).content, goal)
  const answer = chunks.join('')
  const draftId = answer.match(/proposal ([a-f0-9]{64})/)[1]
  const draftPath = resolve(root, 'workspace', 'generated-apps', 'drafts', `draft-${draftId}.json`)
  const record = JSON.parse(readFileSync(draftPath, 'utf8'))
  assert.equal(record.frame.source.goal_cell, goal)
  assert.equal(record.status, 'pending_review')
  assert.equal(record.execution_authorized, false)
  assert.equal(record.external_effects, false)
})

test('GPT-OSS is disabled by default and its configured endpoint is loopback-only', () => {
  assert.deepEqual(resolveGptOssConfig({}), {
    enabled: false, endpoint: 'http://127.0.0.1:18788', modelId: 'gpt-oss-20b',
    contextTokens: null, trainedByNori: false, modelState: 'temporary-imported-checkpoint',
  })
  assert.throws(() => resolveGptOssConfig({ NORI_GPT_OSS_URL: 'https://example.com' }), /loopback/)
  assert.throws(() => resolveGptOssConfig({ NORI_GPT_OSS_URL: 'http://127.0.0.1:18788/path?x=1' }), /loopback/)
  assert.match(gptOssConversationPolicy('balanced'), /Nori uses GPT-OSS 20B as a local inference backend/)
  assert.match(gptOssConversationPolicy('balanced'), /not Nori-trained/)
  assert.match(gptOssConversationPolicy('balanced'), /custom SoN training project has been retired/)
})

test('GPT-OSS-compatible settings identify the configured Qwen model accurately', () => {
  assert.deepEqual(nativeModelChoices({
    NORI_INFERENCE_RUNTIME: 'gpt-oss',
    NORI_GPT_OSS_SERVER_MODEL: 'qwen3.8-27b',
  }), [{
    id: 'qwen3.8:27b',
    label: 'Qwen3.8 27B — configured local inference backend',
  }])
  assert.deepEqual(nativeModelChoices({ NORI_INFERENCE_RUNTIME: 'gpt-oss' }), [{
    id: 'gpt-oss:20b',
    label: 'GPT-OSS 20B — configured local inference backend',
  }])
  assert.throws(() => nativeModelChoices({
    NORI_INFERENCE_RUNTIME: 'gpt-oss',
    NORI_GPT_OSS_SERVER_MODEL: 'qwen 3.8 27b',
  }), /Invalid imported local model identifier/)
})

test('Qwen Aider prompt identifies the active local model instead of GPT-OSS', () => {
  const previous = process.env.NORI_GPT_OSS_SERVER_MODEL
  process.env.NORI_GPT_OSS_SERVER_MODEL = 'qwen3.8-27b'
  try {
    const policy = gptOssConversationPolicy('balanced', '', '', '', false, false, true)
    assert.match(policy, /Qwen3\.8 27B is configured as a local inference backend for Nori/)
    assert.match(policy, /Aider coding worker, backed by local Qwen3\.8 27B/)
    assert.doesNotMatch(policy, /GPT-OSS 20B/)
  } finally {
    if (previous === undefined) delete process.env.NORI_GPT_OSS_SERVER_MODEL
    else process.env.NORI_GPT_OSS_SERVER_MODEL = previous
  }
})

test('Heretic candidate is explicitly described as experimental while chat remains tool-free', () => {
  const previous = process.env.NORI_GPT_OSS_HERETIC
  process.env.NORI_GPT_OSS_HERETIC = '1'
  try {
    const policy = gptOssConversationPolicy('balanced')
    assert.match(policy, /experimental Heretic adapter applied/)
    assert.match(policy, /not behaviorally or safety qualified/)
    assert.match(policy, /No action tools are available in this chat turn/)
    assert.match(policy, /not behaviorally or safety qualified/)
  } finally {
    if (previous === undefined) delete process.env.NORI_GPT_OSS_HERETIC
    else process.env.NORI_GPT_OSS_HERETIC = previous
  }
})

test('GPT-OSS exposes only its bounded project reader for skill and capability discovery requests', () => {
  for (const goal of ['Find Nori skills', 'List installed capabilities', 'What abilities are available?']) {
    assert.equal(requestsNoriProjectRead(goal), true, goal)
  }
  assert.equal(requestsNoriProjectRead('Tell me a penguin joke'), false)
})

test('GPT-OSS skill lookup uses the current request first and prior user context only for follow-ups', () => {
  const turns = [
    { role: 'assistant', text: 'Use React state updates.' },
    { role: 'user', text: 'Help me debug a React useState update.' },
  ]
  assert.match(gptOssSkillContext('React useState now', turns), /Use the existing setter/)
  assert.match(gptOssSkillContext('Continue that', turns), /Use the existing setter/)
  assert.equal(gptOssSkillContext('Tell me a penguin joke', turns), '')
})

test('Nori REA reference skill is hash-pinned and distinguishes server tools from wired actions', () => {
  const context = gptOssSkillContext('Check REA connection and list available tools.', [])
  assert.match(context, /Nori checks REA by verifying Node\.js\/package identity/)
  assert.match(context, /server-advertised catalog is not the same as Nori-wired actions/)
  assert.match(context, /plan-only reference and grants no execution authority/)
})

test('explicit GPT-OSS selection refuses when disabled without touching another runtime', async t => {
  const names = ['NORI_GPT_OSS_ENABLED', 'NORI_GPT_OSS_URL', 'NORI_INFERENCE_RUNTIME']
  const previous = Object.fromEntries(names.map(name => [name, process.env[name]]))
  delete process.env.NORI_GPT_OSS_ENABLED
  process.env.NORI_INFERENCE_RUNTIME = 'norllama'
  let requests = 0
  t.mock.method(globalThis, 'fetch', async () => { requests++; throw new Error('must not fetch') })
  t.after(() => {
    for (const name of names) {
      if (previous[name] === undefined) delete process.env[name]
      else process.env[name] = previous[name]
    }
  })
  await assert.rejects(async () => {
    for await (const _text of localChat({ goal: 'Hello', turns: [], modelSelection: 'gpt-oss:20b' })) void _text
  }, /disabled.*no model substitution or cloud fallback/)
  assert.equal(requests, 0)
})

test('GPT-OSS runtime default never falls through to an Ollama-compatible endpoint', async t => {
  const names = ['NORI_GPT_OSS_ENABLED', 'NORI_GPT_OSS_URL', 'NORI_INFERENCE_RUNTIME', 'OLLAMA_HOST', 'NORI_OLLAMA_URL']
  const previous = Object.fromEntries(names.map(name => [name, process.env[name]]))
  delete process.env.NORI_GPT_OSS_ENABLED
  process.env.NORI_INFERENCE_RUNTIME = 'gpt-oss'
  process.env.OLLAMA_HOST = 'http://127.0.0.1:1'
  process.env.NORI_OLLAMA_URL = 'http://127.0.0.1:1'
  t.after(() => {
    for (const name of names) {
      if (previous[name] === undefined) delete process.env[name]
      else process.env[name] = previous[name]
    }
  })

  await assert.rejects(async () => {
    for await (const _text of localChat({ goal: 'Hello', turns: [] })) void _text
  }, /GPT-OSS local serving is disabled.*no model substitution or cloud fallback/)
})

test('GPT-OSS chat uses only the explicit loopback server, fits context, caps output, and parses chunked SSE', async t => {
  const names = ['NORI_GPT_OSS_ENABLED', 'NORI_GPT_OSS_URL', 'NORI_GPT_OSS_SERVER_MODEL', 'NORI_INFERENCE_RUNTIME','NORI_GPT_OSS_CONTEXT_TOKENS']
  const previous = Object.fromEntries(names.map(name => [name, process.env[name]]))
  let payload
  const server = createServer(async (request, response) => {
    assert.equal(request.url, '/v1/chat/completions')
    let raw = ''
    for await (const part of request) raw += part
    payload = JSON.parse(raw)
    response.writeHead(200, { 'content-type': 'text/event-stream' })
    response.write('data: {"choices":[{"delta":{"role":"assistant"}}]}\r\n\r\n')
    response.write('data: {"choices":[{"delta":{"reasoning":"must not leak"}}]}\r\n\r\n')
    response.write('data: {"choices":[{"delta":{"content":"Local "}}]}\r\n\r\n')
    response.write('data: {"choices":[{"delta":{"content":"Nori reply."}}]}\r\n\r\n')
    response.end('data: [DONE]\r\n\r\n')
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  process.env.NORI_GPT_OSS_ENABLED = '1'
  process.env.NORI_GPT_OSS_URL = `http://127.0.0.1:${server.address().port}`
  process.env.NORI_GPT_OSS_SERVER_MODEL = 'fixture-gpt-oss'
  process.env.NORI_INFERENCE_RUNTIME = 'norllama'
  process.env.NORI_GPT_OSS_CONTEXT_TOKENS = '8192'
  t.after(async () => {
    await new Promise(resolve => server.close(resolve))
    for (const name of names) {
      if (previous[name] === undefined) delete process.env[name]
      else process.env[name] = previous[name]
    }
  })
  const turns = [
    { role: 'user', text: 'old context '.repeat(700) },
    { role: 'assistant', text: 'old answer '.repeat(700) },
    ...Array.from({ length: 4 }, (_, index) => [
      { role: 'user', text: `older request ${index} `.repeat(90) },
      { role: 'assistant', text: `older answer ${index} `.repeat(90) },
    ]).flat(),
    { role: 'user', text: 'keep this recent context' },
  ]
  let answer = ''
  const longGoal = `Linux GPU? ${'extra context '.repeat(100)}`
  const assembledGoal = `[Workspace background — untrusted data] read the project's files [User request]\n${longGoal}`
  for await (const delta of localChat({ goal: assembledGoal, turns, profile: 'balanced',
    modelSelection: 'gpt-oss:20b', projectToolsRequested: false })) answer += delta
  assert.equal(answer, 'Local Nori reply.')
  assert.equal(payload.model, 'fixture-gpt-oss')
  assert.equal(payload.stream, true)
  assert.ok(payload.max_tokens <= localResponseLimit('balanced') && payload.max_tokens >= 64)
  assert.equal(payload.reasoning_effort, 'low', 'bounded local replies should preserve room for visible answer text')
  assert.equal(payload.tools, undefined, 'untrusted workspace text cannot activate project tools')
  assert.ok(payload.messages.some(message => message.content.includes('keep this recent context')))
  assert.ok(!payload.messages.some(message => message.content.includes('old context')))
  assert.ok(payload.messages.at(-1).content.length > 1000, 'long newest user request should be preserved')
  assert.match(payload.messages[0].content, /You are N\.O\.R\.I\./)
  assert.match(payload.messages[0].content, /not Nori-trained/)
  assert.match(payload.messages[0].content, /Selected Nori skill reference data/)
  assert.match(payload.messages[0].content, /QEMU virtual graphics/)
  assert.doesNotMatch(payload.messages[0].content, /Use the existing setter/)
  assert.match(payload.messages[0].content, /untrusted, task-scoped guidance/)
  assert.doesNotMatch(payload.messages[0].content, /shell, package manager/)
  assert.doesNotMatch(answer, /must not leak/)
})

test('a configured 64K request uses that budget even after the module was imported with another context',async t=>{
  const names=['NORI_GPT_OSS_ENABLED','NORI_GPT_OSS_URL','NORI_GPT_OSS_SERVER_MODEL','NORI_GPT_OSS_CONTEXT_TOKENS','NORI_INFERENCE_RUNTIME']
  const previous=Object.fromEntries(names.map(name=>[name,process.env[name]]))
  let payload
  const server=createServer(async(request,response)=>{
    let raw='';for await(const bytes of request)raw+=bytes
    payload=JSON.parse(raw);response.writeHead(200,{'content-type':'text/event-stream'})
    response.end(`data: ${JSON.stringify({choices:[{delta:{content:'CONFIGURED_64K_OK'}}]})}\n\ndata: [DONE]\n\n`)
  })
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
  Object.assign(process.env,{NORI_GPT_OSS_ENABLED:'1',NORI_GPT_OSS_URL:`http://127.0.0.1:${server.address().port}`,NORI_GPT_OSS_SERVER_MODEL:'fixture-gpt-oss',NORI_GPT_OSS_CONTEXT_TOKENS:'65536',NORI_INFERENCE_RUNTIME:'gpt-oss'})
  t.after(async()=>{
    server.closeAllConnections();await new Promise(resolve=>server.close(resolve))
    for(const [key,value] of Object.entries(previous)){if(value===undefined)delete process.env[key];else process.env[key]=value}
  })
  const goal='Preserve this complete current request: '+'a '.repeat(24000)
  let answer=''
  for await(const text of localChat({goal,turns:[],profile:'deep',modelSelection:'nori-auto',projectToolsRequested:false,learned:'optional context\n'.repeat(10000)}))answer+=text
  assert.equal(answer,'CONFIGURED_64K_OK');assert.equal(payload.messages.at(-1).content,goal)
  assert.ok(Buffer.byteLength(JSON.stringify({messages:payload.messages}),'utf8')+128+payload.max_tokens<=65536)
  assert.ok(payload.max_tokens>=64&&payload.max_tokens<=3072)
})

test('GPT-OSS retries one reasoning-only length-limited completion without exposing reasoning', async t => {
  const names = ['NORI_GPT_OSS_ENABLED', 'NORI_GPT_OSS_URL', 'NORI_GPT_OSS_SERVER_MODEL', 'NORI_INFERENCE_RUNTIME']
  const previous = Object.fromEntries(names.map(name => [name, process.env[name]]))
  const payloads = []
  const server = createServer(async (request, response) => {
    let raw = ''
    for await (const part of request) raw += part
    payloads.push(JSON.parse(raw))
    response.writeHead(200, { 'content-type': 'text/event-stream' })
    if (payloads.length === 1) {
      response.end([
        `data: ${JSON.stringify({ choices: [{ delta: { reasoning_content: 'private internal reasoning' } }] })}`,
        `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'length' }] })}`,
        'data: [DONE]', '',
      ].join('\n\n'))
      return
    }
    response.end([
      `data: ${JSON.stringify({ choices: [{ delta: { content: 'Nori is here and ready.' } }] })}`,
      `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] })}`,
      'data: [DONE]', '',
    ].join('\n\n'))
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  process.env.NORI_GPT_OSS_ENABLED = '1'
  process.env.NORI_GPT_OSS_URL = `http://127.0.0.1:${server.address().port}`
  process.env.NORI_GPT_OSS_SERVER_MODEL = 'fixture-gpt-oss'
  process.env.NORI_INFERENCE_RUNTIME = 'gpt-oss'
  t.after(async () => {
    server.closeAllConnections()
    await new Promise(resolve => server.close(resolve))
    for (const name of names) {
      if (previous[name] === undefined) delete process.env[name]
      else process.env[name] = previous[name]
    }
  })

  let answer = ''
  for await (const delta of localChat({ goal: 'Say hello briefly.', turns: [], profile: 'lightning-fast',
    modelSelection: 'fixture-gpt-oss', projectToolsRequested: false })) answer += delta
  assert.equal(answer, 'Nori is here and ready.')
  assert.equal(payloads.length, 2)
  assert.ok(payloads[1].max_tokens > payloads[0].max_tokens)
  assert.doesNotMatch(answer, /private internal reasoning/)
})

test('GPT-OSS retries a normal empty completion once and returns the next visible reply', async t => {
  const names = ['NORI_GPT_OSS_ENABLED', 'NORI_GPT_OSS_URL', 'NORI_GPT_OSS_SERVER_MODEL', 'NORI_INFERENCE_RUNTIME']
  const previous = Object.fromEntries(names.map(name => [name, process.env[name]]))
  const payloads = []
  const server = createServer(async (request, response) => {
    let raw = ''
    for await (const part of request) raw += part
    payloads.push(JSON.parse(raw))
    response.writeHead(200, { 'content-type': 'text/event-stream' })
    if (payloads.length === 1) {
      response.end(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`)
      return
    }
    response.end([
      `data: ${JSON.stringify({ choices: [{ delta: { content: 'Nori is here and ready.' } }] })}`,
      `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] })}`,
      'data: [DONE]', '',
    ].join('\n\n'))
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  process.env.NORI_GPT_OSS_ENABLED = '1'
  process.env.NORI_GPT_OSS_URL = `http://127.0.0.1:${server.address().port}`
  process.env.NORI_GPT_OSS_SERVER_MODEL = 'fixture-gpt-oss'
  process.env.NORI_INFERENCE_RUNTIME = 'gpt-oss'
  t.after(async () => {
    server.closeAllConnections()
    await new Promise(resolve => server.close(resolve))
    for (const name of names) {
      if (previous[name] === undefined) delete process.env[name]
      else process.env[name] = previous[name]
    }
  })

  let answer = ''
  for await (const delta of localChat({ goal: 'Say hello briefly.', turns: [], profile: 'lightning-fast',
    modelSelection: 'fixture-gpt-oss', projectToolsRequested: false })) answer += delta
  assert.equal(answer, 'Nori is here and ready.')
  assert.equal(payloads.length, 2)
  assert.ok(payloads[1].max_tokens > payloads[0].max_tokens)
})

test('GPT-OSS routes ArtCraft catalog requests through bounded Neuralese tools', { timeout: 20000 }, async t => {
  const names = ['NORI_GPT_OSS_ENABLED', 'NORI_GPT_OSS_URL', 'NORI_GPT_OSS_SERVER_MODEL', 'NORI_INFERENCE_RUNTIME', 'NORI_ROOT']
  const previous = Object.fromEntries(names.map(name => [name, process.env[name]]))
  const requests = []
  let handlerError = null
  const server = createServer(async (request, response) => {
    try {
    let raw = ''
    for await (const part of request) raw += part
    const payload = JSON.parse(raw)
    requests.push(payload)
    response.writeHead(200, { 'content-type': 'text/event-stream' })
    if (requests.length === 1) {
      response.end(`data: ${JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'artcraft-call-01', type: 'function', function: { name: 'list_artcraft_apps', arguments: '{"scope":"installed"}' } }] } }] })}\n\ndata: [DONE]\n\n`)
    } else {
      response.end(`data: ${JSON.stringify({ choices: [{ delta: { content: 'Nori found the installed local ArtCraft apps.' } }] })}\n\ndata: [DONE]\n\n`)
    }
    } catch (error) {
      handlerError = error
      if (!response.headersSent) response.writeHead(500)
      response.end('')
    }
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  process.env.NORI_GPT_OSS_ENABLED = '1'
  process.env.NORI_GPT_OSS_URL = `http://127.0.0.1:${server.address().port}`
  process.env.NORI_GPT_OSS_SERVER_MODEL = 'fixture-gpt-oss'
  process.env.NORI_INFERENCE_RUNTIME = 'norllama'
  process.env.NORI_ROOT = 'C:/Nori'
  t.after(async () => {
    server.closeAllConnections?.()
    await new Promise(resolve => server.close(resolve))
    for (const name of names) {
      if (previous[name] === undefined) delete process.env[name]
      else process.env[name] = previous[name]
    }
  })
  let answer = ''
  for await (const part of localChat({ goal: 'Nori, show me the ArtCraft apps installed locally.', turns: [], modelSelection: 'gpt-oss:20b' })) answer += part
  assert.equal(answer, 'Nori found the installed local ArtCraft apps.')
  assert.equal(requests.length, 2)
  assert.ok(requests[0].tools.some(tool => tool.function.name === 'list_artcraft_apps'))
  assert.ok(requests[0].tools.some(tool => tool.function.name === 'launch_artcraft_app'))
  assert.ok(requests[1].messages.some(message => message.role === 'tool' && message.content.includes('photocraft')),
    JSON.stringify(requests[1].messages.filter(message => message.role === 'tool').map(message => message.content)))
  assert.equal(handlerError, null)
  assert.match(requests[0].messages[0].content, /Launching starts the selected GUI process/)
})

test('GPT-OSS routes an ordinary document task to the selected local WordCraft MCP contract', { timeout: 20000 }, async t => {
  const names = ['NORI_GPT_OSS_ENABLED', 'NORI_GPT_OSS_URL', 'NORI_GPT_OSS_SERVER_MODEL', 'NORI_INFERENCE_RUNTIME', 'NORI_ROOT']
  const previous = Object.fromEntries(names.map(name => [name, process.env[name]]))
  let payload
  const server = createServer(async (request, response) => {
    let raw = ''
    for await (const part of request) raw += part
    payload = JSON.parse(raw)
    response.writeHead(200, { 'content-type': 'text/event-stream' })
    response.end(`data: ${JSON.stringify({ choices: [{ delta: { content: 'I can create that document in WordCraft.' } }] })}\n\ndata: [DONE]\n\n`)
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  process.env.NORI_GPT_OSS_ENABLED = '1'
  process.env.NORI_GPT_OSS_URL = `http://127.0.0.1:${server.address().port}`
  process.env.NORI_GPT_OSS_SERVER_MODEL = 'fixture-gpt-oss'
  process.env.NORI_INFERENCE_RUNTIME = 'norllama'
  process.env.NORI_ROOT = 'C:/Nori'
  t.after(async () => {
    server.closeAllConnections?.()
    await new Promise(resolve => server.close(resolve))
    for (const name of names) {
      if (previous[name] === undefined) delete process.env[name]
      else process.env[name] = previous[name]
    }
  })
  await assert.rejects(async () => {
    for await (const part of localChat({ goal: 'Create a short project brief document about local GPU compute.',
      turns: [], modelSelection: 'gpt-oss:20b' })) {}
  }, /without a validated Neuralese plan; no ArtCraft action was performed/)
  assert.deepEqual(payload.tools.map(tool => tool.function.name), ['artcraft_wordcraft_neuralese_plan'])
  assert.match(payload.messages[0].content, /Use only the supplied Neuralese plan tool/)
  const ingress = JSON.parse(payload.messages.at(-1).content)
  assert.equal(ingress.schema, 'nori.neuralese.artcraft-ingress.v1')
  assert.equal(ingress.target_slot, 'wordcraft')
  assert.equal(ingress.intent_cell, 'Create a short project brief document about local GPU compute.')
})

test('GPT-OSS repairs registered PhotoCraft field labels through Neuralese before its single dispatch', { timeout: 20000 }, async t => {
  const names = ['NORI_GPT_OSS_ENABLED', 'NORI_GPT_OSS_URL', 'NORI_GPT_OSS_SERVER_MODEL', 'NORI_INFERENCE_RUNTIME', 'NORI_ROOT']
  const previous = Object.fromEntries(names.map(name => [name, process.env[name]]))
  const goal = 'Use PhotoCraft to create a blank raster document 128 by 96 pixels.'
  const operation = 'artcraft_photocraft_doc_new'
  const opcode = Number.parseInt(createHash('sha256').update(operation, 'utf8').digest('hex').slice(0, 8), 16)
  let requestCount = 0
  const calls = []
  const server = createServer(async (request, response) => {
    requestCount++
    let raw = ''
    for await (const part of request) raw += part
    const payload = JSON.parse(raw)
    const planTool = payload.tools[0].function.name
    assert.equal(planTool, 'artcraft_photocraft_neuralese_plan')
    const malformed = JSON.stringify({ schema: 'nori.neuralese.artcraft-plan.v1', app_id: 'photocraft', status: 'complete',
      nodes: [{ id: 'n0', opcode, slots: { width: 128, height: 96, mode: 'RGBA', depth: 8 }, depends_on: [] }], clarification: null })
    response.writeHead(200, { 'content-type': 'text/event-stream' })
    response.end(`data: ${JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'photo-labels', type: 'function',
      function: { name: planTool, arguments: malformed } }] } }] })}\n\ndata: [DONE]\n\n`)
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  process.env.NORI_GPT_OSS_ENABLED = '1'
  process.env.NORI_GPT_OSS_URL = `http://127.0.0.1:${server.address().port}`
  process.env.NORI_GPT_OSS_SERVER_MODEL = 'fixture-gpt-oss'
  process.env.NORI_INFERENCE_RUNTIME = 'gpt-oss'
  process.env.NORI_ROOT = 'C:/Nori'
  t.after(async () => {
    server.closeAllConnections?.()
    await new Promise(resolve => server.close(resolve))
    for (const name of names) {
      if (previous[name] === undefined) delete process.env[name]
      else process.env[name] = previous[name]
    }
  })
  const definitions = [{ type: 'function', function: { name: operation, description: 'Create a blank raster document.',
    parameters: { type: 'object', additionalProperties: false, properties: {
      width: { type: 'integer', minimum: 16, maximum: 8192 }, height: { type: 'integer', minimum: 16, maximum: 8192 },
      mode: { type: 'string', enum: ['RGB', 'RGBA'] }, depth: { type: 'integer', enum: [8, 16, 32] },
    }, required: ['width', 'height', 'mode', 'depth'] } } }]
  let answer = ''
  for await (const part of localChat({ goal, turns: [], modelSelection: 'fixture-gpt-oss',
    artCraftMcpFactory: async appId => ({ appId, definitions, async close() {},
      async call(name, args) { calls.push({ name, args })
        return JSON.stringify({ isError: false, content: [{ type: 'text', text: 'Created PhotoCraft raster outputs/nori-blank.pcraft.' }] })
      } }) })) answer += part
  assert.equal(requestCount, 1, 'a catalog-label correction must not spend another model turn')
  assert.deepEqual(calls, [{ name: operation, args: { width: 128, height: 96, mode: 'RGBA', depth: 8 } }])
  assert.match(answer, /translated.*field labels.*Neuralese slot IDs/i)
  assert.match(answer, /outputs\/nori-blank\.pcraft/)
})

test('GPT-OSS returns a confirmed Neuralese ArtCraft receipt without an oversized second model turn', { timeout: 20000 }, async t => {
  const names = ['NORI_GPT_OSS_ENABLED', 'NORI_GPT_OSS_URL', 'NORI_GPT_OSS_SERVER_MODEL', 'NORI_INFERENCE_RUNTIME', 'NORI_ROOT']
  const previous = Object.fromEntries(names.map(name => [name, process.env[name]]))
  const goal = 'Use WordCraft to create a trip-planning document.'
  const toolName = 'artcraft_wordcraft_new_document'
  const opcode = Number.parseInt(createHash('sha256').update(toolName).digest('hex').slice(0, 8), 16)
  const plan = JSON.stringify({ schema: 'nori.neuralese.artcraft-plan.v1', app_id: 'wordcraft', status: 'complete',
    nodes: [{ id: 'n0', opcode, slots: { 0: 'Trip Plan', 1: 'docx' }, depends_on: [] }], clarification: null })
  const badSlotPlan = JSON.stringify({ schema: 'nori.neuralese.artcraft-plan.v1', app_id: 'wordcraft', status: 'complete',
    nodes: [{ id: 'n0', opcode, slots: { 99: 'Trip Plan', 1: 'docx' }, depends_on: [] }], clarification: null })
  let requestCount = 0
  let mode = 'normal', repairAttempt = 0, sawRepairFeedback = false
  const server = createServer(async (request, response) => {
    requestCount++
    let raw = ''
    for await (const part of request) raw += part
    const payload = JSON.parse(raw)
    assert.deepEqual(payload.tools.map(tool => tool.function.name), ['artcraft_wordcraft_neuralese_plan'])
    assert.ok(payload.max_tokens > 240, 'machine-readable plans must not inherit the terse prose cap')
    assert.equal(payload.reasoning_effort, 'low')
    assert.equal(payload.temperature, 0, 'tool graph planning should not use conversational sampling')
    if (mode === 'repair' && repairAttempt === 1) {
      sawRepairFeedback = payload.messages[0].content.includes('Previous plan rejected before any app action')
        && payload.messages.some(message => message.role === 'assistant'
          && message.tool_calls?.some(call => call.id === 'call_plan'
            && JSON.parse(call.function.arguments).nodes[0].slots['99'] === 'Trip Plan'))
        && payload.messages.some(message => message.role === 'tool'
          && message.tool_call_id === 'call_plan' && message.content.includes('unregistered slot'))
    }
    const selectedPlan = mode === 'repair'
      ? (++repairAttempt > 1 ? plan : badSlotPlan)
      : mode === 'runtime' || requestCount === 1 ? plan : badSlotPlan
    response.writeHead(200, { 'content-type': 'text/event-stream' })
    response.end(`data: ${JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_plan', type: 'function',
      function: { name: 'artcraft_wordcraft_neuralese_plan', arguments: selectedPlan } }] } }] })}\n\ndata: [DONE]\n\n`)
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  process.env.NORI_GPT_OSS_ENABLED = '1'
  process.env.NORI_GPT_OSS_URL = `http://127.0.0.1:${server.address().port}`
  process.env.NORI_GPT_OSS_SERVER_MODEL = 'fixture-gpt-oss'
  process.env.NORI_INFERENCE_RUNTIME = 'gpt-oss'
  process.env.NORI_ROOT = 'C:/Nori'
  const calls = []
  const definitions = [{ type: 'function', function: { name: toolName, description: 'Create document', parameters: {
    type: 'object', additionalProperties: false,
    properties: { title: { type: 'string' }, format: { type: 'string', enum: ['docx'] } }, required: ['title', 'format'],
  } } }]
  t.after(async () => {
    server.closeAllConnections?.()
    await new Promise(resolve => server.close(resolve))
    for (const name of names) {
      if (previous[name] === undefined) delete process.env[name]
      else process.env[name] = previous[name]
    }
  })
  let answer = ''
  for await (const part of localChat({ goal, turns: [], modelSelection: 'fixture-gpt-oss',
    artCraftMcpFactory: async appId => ({ appId, definitions,
      async call(name, args) {
        calls.push({ name, args })
        return JSON.stringify({ isError: false, content: [{ type: 'text', text: 'Created and saved outputs/trip-plan.docx.' }] })
      }, async close() {} }) })) answer += part
  assert.equal(requestCount, 1, 'a verified receipt should be decoded directly, without another inference round')
  assert.deepEqual(calls, [{ name: toolName, args: { title: 'Trip Plan', format: 'docx' } }])
  assert.match(answer, /Neuralese-validated action/)
  assert.match(answer, /outputs\/trip-plan\.docx/)
  await assert.rejects(async () => {
    for await (const part of localChat({ goal, turns: [], modelSelection: 'fixture-gpt-oss',
      artCraftMcpFactory: async appId => ({ appId, definitions,
        async call() { assert.fail('A rejected plan must never dispatch an app action') }, async close() {} }) })) {}
  }, /Neuralese action node 0 uses an unregistered slot/)
  mode = 'repair'
  let repaired = ''
  let executions = 0
  for await (const part of localChat({goal,turns:[],modelSelection:'fixture-gpt-oss',
    artCraftMcpFactory:async appId=>({appId,definitions,async call(){executions++
      return JSON.stringify({isError:false,content:[{type:'text',text:'Saved repaired document.'}]})},async close(){}})})) repaired += part
  assert.equal(repairAttempt,2)
  assert.equal(sawRepairFeedback,true)
  assert.equal(executions,1,'only the corrected plan may reach the app')
  assert.match(repaired,/Saved repaired document/)
  assert.match(repaired,/no app action has run.*one correction/)
  mode = 'runtime'
  const beforeFailure = requestCount
  await assert.rejects(async()=>{
    for await (const part of localChat({goal,turns:[],modelSelection:'fixture-gpt-oss',
      artCraftMcpFactory:async appId=>({appId,definitions,async call(){
        return JSON.stringify({isError:true,content:[{type:'text',text:'Synthetic save failure'}]})},async close(){}})})) {}
  },/Synthetic save failure/)
  assert.equal(requestCount,beforeFailure+1,'a runtime failure must not trigger plan retry')
})

test('GPT-OSS trims optional learned and skill context before a serialized prompt can overflow', async t => {
  const names = ['NORI_GPT_OSS_ENABLED', 'NORI_GPT_OSS_URL', 'NORI_GPT_OSS_SERVER_MODEL','NORI_GPT_OSS_CONTEXT_TOKENS']
  const previous = Object.fromEntries(names.map(name => [name, process.env[name]]))
  let payload
  const server = createServer(async (request, response) => {
    let raw = ''
    for await (const part of request) raw += part
    payload = JSON.parse(raw)
    response.writeHead(200, { 'content-type': 'text/event-stream' })
    response.end(`data: ${JSON.stringify({ choices: [{ delta: { content: 'Hello from local Nori.' } }] })}\n\ndata: [DONE]\n\n`)
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  process.env.NORI_GPT_OSS_ENABLED = '1'
  process.env.NORI_GPT_OSS_URL = `http://127.0.0.1:${server.address().port}`
  process.env.NORI_GPT_OSS_SERVER_MODEL = 'fixture-gpt-oss'
  process.env.NORI_GPT_OSS_CONTEXT_TOKENS = '4096'
  t.after(async () => {
    server.closeAllConnections()
    await new Promise(resolve => server.close(resolve))
    for (const name of names) {
      if (previous[name] === undefined) delete process.env[name]
      else process.env[name] = previous[name]
    }
  })

  let answer = ''
  for await (const delta of localChat({
    goal: 'Say hello briefly.', turns: [], profile: 'balanced', modelSelection: 'gpt-oss:20b',
    personality: `style\n${'warm and direct\n'.repeat(220)}`,
    learned: `preferences\n${'preserve useful context\n'.repeat(700)}LEARNED_TAIL_SENTINEL`,
    projectToolsRequested: false,
  })) answer += delta

  assert.equal(answer, 'Hello from local Nori.')
  assert.equal(payload.messages.at(-1).content, 'Say hello briefly.')
  assert.match(payload.messages[0].content, /You are N\.O\.R\.I\./)
  assert.ok(Buffer.byteLength(JSON.stringify({ messages: payload.messages }), 'utf8') + 128 + 64 <= 4096)
  assert.ok(payload.max_tokens >= 64)
  assert.ok(payload.messages[0].content.length < 5000, 'optional context should be reduced instead of overflowing the server context')
  assert.doesNotMatch(payload.messages[0].content, /LEARNED_TAIL_SENTINEL/)
})

for (const configuredModel of ['fixture-local-9b', 'fixture-local-14b']) {
test(`imported model ${configuredModel} uses Nori project reads with exact tool-call IDs`, async t => {
  const names = ['NORI_INFERENCE_RUNTIME', 'NORI_GPT_OSS_ENABLED', 'NORI_GPT_OSS_URL', 'NORI_GPT_OSS_SERVER_MODEL', 'NORI_ROOT', 'NORI_APP_DATA_ROOT']
  const previous = Object.fromEntries(names.map(name => [name, process.env[name]]))
  const root = mkdtempSync(join(tmpdir(), 'nori-local-chat-tools-'))
  writeFileSync(join(root, 'README.md'), 'NORI_TOOL_FIXTURE_ZEPHYR-271\nPrivate second line omitted.\n')
  const payloads = []
  let calls = 0
  const server = createServer(async (request, response) => {
    let raw = ''
    for await (const part of request) raw += part
    const payload = JSON.parse(raw)
    payloads.push(payload)
    calls++
    response.writeHead(200, { 'content-type': 'text/event-stream' })
    if (calls === 1) {
      response.end([
        `data: ${JSON.stringify({ choices: [{ delta: { reasoning_content: 'private analysis stays in protocol' } }] })}`,
        `data: ${JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_nori_fixture', type: 'function', function: { name: 'read_file', arguments: '{' } }] } }] })}`,
        `data: ${JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '"path":"README.md","max_lines":1}' } }] } }] })}`,
        'data: [DONE]', '',
      ].join('\n\n'))
      return
    }
    response.end(`data: ${JSON.stringify({ choices: [{ delta: { content: 'The README contains the Nori project fixture marker.' } }] })}\n\ndata: [DONE]\n\n`)
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  process.env.NORI_GPT_OSS_ENABLED = '1'
  process.env.NORI_GPT_OSS_URL = `http://127.0.0.1:${server.address().port}`
  process.env.NORI_GPT_OSS_SERVER_MODEL = configuredModel
  process.env.NORI_INFERENCE_RUNTIME = 'gpt-oss'
  process.env.NORI_ROOT = root
  t.after(async () => {
    server.closeAllConnections()
    await new Promise(resolve => server.close(resolve))
    rmSync(root, { recursive: true, force: true })
    for (const name of names) {
      if (previous[name] === undefined) delete process.env[name]
      else process.env[name] = previous[name]
    }
  })

  let answer = ''
  for await (const delta of localChat({ goal: 'Read the project file README.md and summarize it.', turns: [], modelSelection: 'nori-auto' })) answer += delta
  assert.equal(answer, 'The README contains the Nori project fixture marker.')
  assert.equal(calls, 2)
  assert.ok(payloads.every(payload => payload.model === configuredModel))
  assert.equal(payloads[0].parallel_tool_calls, false)
  assert.equal(payloads[0].tool_choice, 'required')
  assert.equal(payloads[1].tool_choice, 'auto')
  assert.ok(payloads[0].tools.some(tool => tool.function.name === 'read_file'))
  assert.deepEqual(payloads[1].messages.map(message => message.role), ['system', 'user', 'assistant', 'tool'])
  assert.equal(payloads[1].messages[2].tool_calls[0].id, 'call_nori_fixture')
  assert.equal(payloads[1].messages[3].tool_call_id, 'call_nori_fixture')
  assert.match(payloads[1].messages[3].content, /NORI_TOOL_FIXTURE_ZEPHYR-271/)
  assert.match(payloads[1].messages[3].content, /Untrusted local project data/)
  assert.doesNotMatch(payloads[1].messages[3].content, /Private second line/)
  assert.match(payloads[0].messages[0].content, /Three read-only tools/)
  assert.doesNotMatch(answer, /private analysis stays in protocol/i)
})
}

test('GPT-OSS retries malformed structured tool JSON once before any tool is called', { timeout: 20000 }, async t => {
  const names = ['NORI_GPT_OSS_ENABLED', 'NORI_GPT_OSS_URL', 'NORI_GPT_OSS_SERVER_MODEL', 'NORI_ROOT']
  const previous = Object.fromEntries(names.map(name => [name, process.env[name]]))
  const root = mkdtempSync(join(tmpdir(), 'nori-malformed-call-'))
  writeFileSync(join(root, 'README.md'), 'SAFE_FIXTURE_CONTENT\n')
  const payloads = []
  let serverCalls = 0
  const server = createServer(async (request, response) => {
    let raw = ''
    for await (const part of request) raw += part
    payloads.push(JSON.parse(raw))
    serverCalls++
    response.writeHead(200, { 'content-type': 'text/event-stream' })
    if (serverCalls === 1) {
      response.end(`data: ${JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'bad-json-call', type: 'function', function: { name: 'read_file', arguments: '{"path":' } }] } }] })}\n\ndata: [DONE]\n\n`)
    } else if (serverCalls === 2) {
      response.end(`data: ${JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'repaired-json-call', type: 'function', function: { name: 'read_file', arguments: '{"path":"README.md","max_lines":1}' } }] } }] })}\n\ndata: [DONE]\n\n`)
    } else {
      response.end(`data: ${JSON.stringify({ choices: [{ delta: { content: 'The local file was read after the corrected call.' } }] })}\n\ndata: [DONE]\n\n`)
    }
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  process.env.NORI_GPT_OSS_ENABLED = '1'
  process.env.NORI_GPT_OSS_URL = `http://127.0.0.1:${server.address().port}`
  process.env.NORI_GPT_OSS_SERVER_MODEL = 'fixture-gpt-oss'
  process.env.NORI_ROOT = root
  t.after(async () => {
    server.closeAllConnections()
    await new Promise(resolve => server.close(resolve))
    rmSync(root, { recursive: true, force: true })
    for (const name of names) {
      if (previous[name] === undefined) delete process.env[name]
      else process.env[name] = previous[name]
    }
  })
  let answer = ''
  for await (const part of localChat({ goal: 'Read README.md and summarize it.', turns: [], modelSelection: 'gpt-oss:20b', projectToolsRequested: true })) answer += part
  assert.equal(answer, 'The local file was read after the corrected call.')
  assert.equal(serverCalls, 3)
  assert.match(payloads[1].messages[0].content, /previous structured tool arguments were invalid JSON and no tool ran/i)
  assert.equal(payloads[1].messages.at(-1).role, 'tool')
  assert.equal(payloads[1].messages.at(-1).tool_call_id, 'bad-json-call')
  assert.match(payloads[2].messages.at(-1).content, /SAFE_FIXTURE_CONTENT/)
})

test('GPT-OSS recovers conversationally after a denied tool call without replaying stale task output', { timeout: 20000 }, async t => {
  const names = ['NORI_GPT_OSS_ENABLED', 'NORI_GPT_OSS_URL', 'NORI_GPT_OSS_SERVER_MODEL', 'NORI_ROOT']
  const previous = Object.fromEntries(names.map(name => [name, process.env[name]]))
  const root = mkdtempSync(join(tmpdir(), 'nori-failed-tool-recovery-'))
  const payloads = []
  let serverCalls = 0
  const server = createServer(async (request, response) => {
    let raw = ''
    for await (const part of request) raw += part
    payloads.push(JSON.parse(raw))
    serverCalls++
    response.writeHead(200, { 'content-type': 'text/event-stream' })
    if (serverCalls === 1) {
      response.end(`data: ${JSON.stringify({ choices: [{ delta: { content: 'I completed the read.' } }] })}\n\n` +
        `data: ${JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'denied-path-call', type: 'function', function: { name: 'read_file', arguments: '{"path":"../outside.txt","max_lines":1}' } }] } }] })}\n\ndata: [DONE]\n\n`)
    } else {
      response.end(`data: ${JSON.stringify({ choices: [{ delta: { content: 'I could not read that path; it was blocked and nothing was changed.' } }] })}\n\ndata: [DONE]\n\n`)
    }
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  process.env.NORI_GPT_OSS_ENABLED = '1'
  process.env.NORI_GPT_OSS_URL = `http://127.0.0.1:${server.address().port}`
  process.env.NORI_GPT_OSS_SERVER_MODEL = 'fixture-gpt-oss'
  process.env.NORI_ROOT = root
  t.after(async () => {
    server.closeAllConnections()
    await new Promise(resolve => server.close(resolve))
    rmSync(root, { recursive: true, force: true })
    for (const name of names) {
      if (previous[name] === undefined) delete process.env[name]
      else process.env[name] = previous[name]
    }
  })
  let answer = ''
  for await (const part of localChat({ goal: 'Read the project file README.md.', turns: [], modelSelection: 'gpt-oss:20b', projectToolsRequested: true })) answer += part
  assert.equal(answer, 'I could not read that path; it was blocked and nothing was changed.')
  assert.doesNotMatch(answer, /completed the read/i)
  assert.equal(serverCalls, 2)
  const failedTool = payloads[1].messages.find(message => message.role === 'tool')
  assert.match(failedTool.content, /"executed":false/)
  assert.match(failedTool.content, /not available through the bounded Nori project reader/i)
})

test('GPT-OSS routes an explicit local app request through the Neuralese-only proposal tool', async t => {
  const names = ['NORI_GPT_OSS_ENABLED', 'NORI_GPT_OSS_URL', 'NORI_GPT_OSS_SERVER_MODEL', 'NORI_ROOT']
  const previous = Object.fromEntries(names.map(name => [name, process.env[name]]))
  const root = mkdtempSync(join(tmpdir(), 'nori-local-app-route-'))
  const goal = 'Build a local notes app with a title and pinned flag.'
  const proposal = {
    spec_id: 'local-notes', title: 'Local Notes', description: 'A local notes app.',
    source: { goal_cell: goal },
    data_schema: [{ id: 'note', name: 'Note', fields: [
      { id: 'title', name: 'Title', type: 'string', required: true, options: null, default: null },
      { id: 'pinned', name: 'Pinned', type: 'boolean', required: false, options: null, default: false },
    ] }],
    views: [{ id: 'notes', name: 'Notes', type: 'table', collection_id: 'note', fields: ['title', 'pinned'] }],
    workflows: [], capabilities: ['local_data.read'], unknown_fields: [], translation_losses: [],
  }
  const payloads = []
  let calls = 0
  const server = createServer(async (request, response) => {
    let raw = ''
    for await (const part of request) raw += part
    payloads.push(JSON.parse(raw))
    calls++
    response.writeHead(200, { 'content-type': 'text/event-stream' })
    if (calls === 1) {
      const args = JSON.stringify({ spec_json: JSON.stringify(proposal) })
      response.end([
        `data: ${JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_local_app', type: 'function', function: { name: 'propose_local_app', arguments: args } }] } }] })}`,
        'data: [DONE]', '',
      ].join('\n\n'))
      return
    }
    response.end(`data: ${JSON.stringify({ choices: [{ delta: { content: 'I prepared a validated local app proposal for your review; it has not been built or run.' } }] })}\n\ndata: [DONE]\n\n`)
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  process.env.NORI_GPT_OSS_ENABLED = '1'
  process.env.NORI_GPT_OSS_URL = `http://127.0.0.1:${server.address().port}`
  delete process.env.NORI_GPT_OSS_SERVER_MODEL
  process.env.NORI_ROOT = root
  process.env.NORI_APP_DATA_ROOT = root
  t.after(async () => {
    server.closeAllConnections()
    await new Promise(resolve => server.close(resolve))
    rmSync(root, { recursive: true, force: true })
    for (const name of names) {
      if (previous[name] === undefined) delete process.env[name]
      else process.env[name] = previous[name]
    }
  })
  let answer = ''
  for await (const delta of localChat({ goal, turns: [], modelSelection: 'gpt-oss:20b' })) answer += delta
  assert.match(answer, /proposal for your review/)
  assert.equal(calls, 2)
  assert.deepEqual(payloads[0].tools.map(tool => tool.function.name), ['propose_local_app'])
  assert.match(payloads[0].messages[0].content, /validates a Neuralese proposal/)
  assert.equal(payloads[1].messages[3].tool_call_id, 'call_local_app')
  assert.match(payloads[1].messages[3].content, /ready_for_local_preview/)
  assert.match(payloads[1].messages[3].content, /execution_authorized\\?":false/)
  assert.match(payloads[1].messages[3].content, /Saved as a pending local draft/)
  assert.equal(readdirSync(join(root, 'workspace', 'generated-apps', 'drafts')).length, 1)
})

test('GPT-OSS buffers identity and SoN status answers for grounded correction', async t => {
  const names = ['NORI_GPT_OSS_ENABLED', 'NORI_GPT_OSS_URL', 'NORI_GPT_OSS_SERVER_MODEL']
  const previous = Object.fromEntries(names.map(name => [name, process.env[name]]))
  let calls = 0
  const server = createServer(async (request, response) => {
    calls++
    let raw = ''
    for await (const part of request) raw += part
    const userText = JSON.parse(raw).messages.at(-1).content
    const claim = /who are you/i.test(userText) ? 'I am your Chief Operating Officer.'
      : 'Nori-20B SoN is already being trained and serving.'
    response.writeHead(200, { 'content-type': 'text/event-stream' })
    response.end(`data: ${JSON.stringify({ choices: [{ delta: { content: claim } }] })}\n\ndata: [DONE]\n\n`)
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  process.env.NORI_GPT_OSS_ENABLED = '1'
  process.env.NORI_GPT_OSS_URL = `http://127.0.0.1:${server.address().port}`
  delete process.env.NORI_GPT_OSS_SERVER_MODEL
  t.after(async () => {
    await new Promise(resolve => server.close(resolve))
    for (const name of names) {
      if (previous[name] === undefined) delete process.env[name]
      else process.env[name] = previous[name]
    }
  })
  for (const goal of ['Who are you?', 'Is Nori-20B SoN training or serving?']) {
    let answer = ''
    for await (const delta of localChat({ goal, turns: [], modelSelection: 'gpt-oss:20b' })) answer += delta
    assert.doesNotMatch(answer, /Chief Operating Officer|already being trained and serving/i)
    if (goal.startsWith('Who')) assert.match(answer, /I'm N\.O\.R\.I\./)
    else assert.match(answer, /custom SoN training project has been retired/i)
  }
  assert.equal(calls, 2)
})

test('closing a GPT-OSS stream aborts its owned local HTTP request', async t => {
  const names = ['NORI_GPT_OSS_ENABLED', 'NORI_GPT_OSS_URL']
  const previous = Object.fromEntries(names.map(name => [name, process.env[name]]))
  let disconnected
  const disconnectedPromise = new Promise(resolve => { disconnected = resolve })
  const server = createServer(async (request, response) => {
    for await (const _part of request) { /* drain request */ }
    response.writeHead(200, { 'content-type': 'text/event-stream' })
    response.write('data: {"choices":[{"delta":{"content":"first"}}]}\n\n')
    response.on('close', () => disconnected())
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  process.env.NORI_GPT_OSS_ENABLED = '1'
  process.env.NORI_GPT_OSS_URL = `http://127.0.0.1:${server.address().port}`
  t.after(async () => {
    server.closeAllConnections()
    await new Promise(resolve => server.close(resolve))
    for (const name of names) {
      if (previous[name] === undefined) delete process.env[name]
      else process.env[name] = previous[name]
    }
  })
  const stream = localChat({ goal: 'Hello', turns: [], modelSelection: 'gpt-oss:20b', projectToolsRequested: false })
  assert.deepEqual(await stream.next(), { value: 'first', done: false })
  await stream.return()
  await Promise.race([disconnectedPromise, new Promise((_, reject) => setTimeout(() => reject(new Error('local request was not cancelled')), 2000))])
})

test('NorLlama routes a local WordCraft request through Neuralese validation and the scoped broker', async t => {
  const names = ['NORI_INFERENCE_RUNTIME', 'NORI_RUNTIME_MODEL_ID', 'NORI_RUNTIME_MODEL_STATE', 'NORI_ROOT', 'NORI_APP_DATA_ROOT']
  const previous = Object.fromEntries(names.map(name => [name, process.env[name]]))
  process.env.NORI_INFERENCE_RUNTIME = 'norllama'
  process.env.NORI_RUNTIME_MODEL_ID = 'llama3.2-3b-instruct'
  process.env.NORI_RUNTIME_MODEL_STATE = 'ready'
  process.env.NORI_ROOT = 'C:/Nori'
  process.env.NORI_APP_DATA_ROOT = 'C:/Nori/test-output'
  t.after(() => {
    for (const name of names) {
      if (previous[name] === undefined) delete process.env[name]
      else process.env[name] = previous[name]
    }
  })

  const definitions = [{ type: 'function', function: { name: 'artcraft_wordcraft_new_document',
    description: 'Create a new document.',
    parameters: { type: 'object', additionalProperties: false,
      properties: { title: { type: 'string', minLength: 1, maxLength: 80 }, format: { type: 'string', enum: ['docx'] } },
      required: ['title', 'format'] } } }]
  const toolName = definitions[0].function.name
  const op = Number.parseInt(createHash('sha256').update(toolName, 'utf8').digest('hex').slice(0, 8), 16)
  const plannedOutput = JSON.stringify({ schema: 'nori.neuralese.artcraft-plan.v1', app_id: 'wordcraft', status: 'complete',
    nodes: [{ id: 'n0', opcode: op, slots: { 0: 'Local Router Proof', 1: 'docx' }, depends_on: [] }], clarification: null })
  const calls = []
  let closed = false
  let seenMessages
  const answer = []
  for await (const part of localChat({
    goal: 'Use WordCraft to create a document titled "Local Router Proof".',
    turns: [], modelSelection: 'llama3.2-3b-instruct',
    nativeCounter: async () => ({ framing: byteFraming(), countContent: byteCount }),
    nativeChatGenerator: async function* (request) {
      seenMessages = request.messages
      yield plannedOutput
    },
    artCraftMcpFactory: async (appId, options) => {
      assert.equal(appId, 'wordcraft')
      assert.match(options.goal, /Local Router Proof/)
      return { appId, definitions, async call(name, args) {
        calls.push({ name, args })
        return JSON.stringify({ isError: false, content: [{ type: 'text', text: 'Created outputs/local-router-proof.docx.' }] })
      }, async close() { closed = true } }
    },
  })) answer.push(part)

  assert.equal(calls.length, 1)
  assert.deepEqual(calls[0], { name: toolName, args: { title: 'Local Router Proof', format: 'docx' } })
  assert.equal(closed, true)
  assert.ok(seenMessages.some(message => message.role === 'user' && message.content.includes('nori.neuralese.artcraft-ingress.v1')))
  assert.ok(answer.join('').includes('Neuralese-validated action'))
  assert.ok(answer.join('').includes('Created outputs/local-router-proof.docx.'))
})
