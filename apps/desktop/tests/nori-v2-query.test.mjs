import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createNeuralEventLedger } from '../bridge/neural-event-contract.mjs'
import { encodeNeuraleseIntent } from '../bridge/neuralese-intent.mjs'
import { encodeNeuraleseAttachment } from '../bridge/neuralese-attachment.mjs'
import { observeBridgeNeuralSignal, observedNeuralSignals, clearNeuralSignals } from '../src/scene/neural-signals.ts'
// Synthetic loopback contracts; no model or production serving configuration.
process.env.NORI_INFERENCE_RUNTIME = 'norllama'
// Keep synthetic contracts independent of the owner's saved memory and real
// tokenizer. The explicit absent config selects the conservative byte counter.
const fixtureSettings=mkdtempSync(join(tmpdir(),'nori-query-contract-'))
const previousSettings=process.env.NORI_SETTINGS_DIR
const previousCounter=process.env.NORI_RUNTIME_CONFIG_PATH
process.env.NORI_SETTINGS_DIR=fixtureSettings
process.env.NORI_RUNTIME_CONFIG_PATH=join(fixtureSettings,'absent-config.json')
after(()=>{
  if(previousSettings===undefined)delete process.env.NORI_SETTINGS_DIR;else process.env.NORI_SETTINGS_DIR=previousSettings
  if(previousCounter===undefined)delete process.env.NORI_RUNTIME_CONFIG_PATH;else process.env.NORI_RUNTIME_CONFIG_PATH=previousCounter
  rmSync(fixtureSettings,{recursive:true,force:true})
})

test('explicit creative work has a bounded task deadline without extending ordinary chat', async () => {
  const { localReplyTimeoutMs } = await import('../bridge/nori-v2-query.mjs')
  assert.equal(localReplyTimeoutMs('Say hello.'), 120000)
  assert.equal(localReplyTimeoutMs('Use EffectCraft to create a 2-second blue circle animation.'), 300000)
  assert.equal(localReplyTimeoutMs('Use WordCraft to create a short document.'), 300000)
})

async function nativeChatFixture(t, received, answer = 'NORI_CHAT_OK') {
  const saved = Object.fromEntries(['NORI_RUNTIME_URL','NORI_RUNTIME_API_KEY','NORI_RUNTIME_MODEL_ID'].map(key=>[key,process.env[key]]))
  const token = 'fixture-native-token-not-a-production-credential'
  const server = createServer(async (request,response)=>{
    assert.equal(request.url,'/v1/chat')
    assert.equal(request.method,'POST')
    assert.equal(request.headers.authorization,`Bearer ${token}`)
    let body=''; for await(const chunk of request) body+=chunk
    received.push(JSON.parse(body))
    response.writeHead(200,{'content-type':'text/event-stream'})
    response.end(`event: token\ndata: ${JSON.stringify({text:answer})}\n\nevent: done\ndata: [DONE]\n\n`)
  })
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
  process.env.NORI_RUNTIME_URL=`http://127.0.0.1:${server.address().port}`
  process.env.NORI_RUNTIME_API_KEY=token
  process.env.NORI_RUNTIME_MODEL_ID='fixture-native-model'
  t.after(()=>{
    server.close()
    for(const [key,value] of Object.entries(saved)) {
      if(value===undefined) delete process.env[key]; else process.env[key]=value
    }
  })
}

test('desktop controller reaches general chooser and offers base tools to local chat', { timeout: 15000 }, async t => {
  const keys = ['NORI_INFERENCE_RUNTIME','NORI_LOCAL_CHAT','NORI_GPT_OSS_ENABLED','NORI_GPT_OSS_URL','NORI_GPT_OSS_SERVER_MODEL','NORI_GPT_OSS_CONTEXT_TOKENS']
  const saved = Object.fromEntries(keys.map(key => [key, process.env[key]]))
  const payloads = []
  const server = createServer(async (request, response) => {
    let raw = ''; for await (const chunk of request) raw += chunk
    const payload = JSON.parse(raw); payloads.push(payload)
    if (!payload.stream) {
      response.writeHead(200, { 'content-type': 'application/json' })
      // An unavailable choice must retain basic capabilities rather than disable them.
      response.end(JSON.stringify({ choices: [{ message: { tool_calls: [] }, finish_reason: 'stop' }] }))
    } else {
      response.writeHead(200, { 'content-type': 'text/event-stream' })
      response.end('data: {"choices":[{"delta":{"content":"CONTROLLER_UNION_OK"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n')
    }
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(async () => {
    server.closeAllConnections(); await new Promise(resolve => server.close(resolve))
    for (const [key, value] of Object.entries(saved)) { if (value === undefined) delete process.env[key]; else process.env[key] = value }
  })
  Object.assign(process.env, { NORI_INFERENCE_RUNTIME:'gpt-oss', NORI_LOCAL_CHAT:'1', NORI_GPT_OSS_ENABLED:'1',
    NORI_GPT_OSS_URL:`http://127.0.0.1:${server.address().port}`, NORI_GPT_OSS_SERVER_MODEL:'fixture-controller', NORI_GPT_OSS_CONTEXT_TOKENS:'65536' })
  const { query } = await import(`../bridge/nori-v2-query.mjs?union-controller=${Date.now()}`)
  async function* prompt() { yield { message: { content: 'Help me with this task.' } } }
  const results = []
  for await (const message of query({ prompt: prompt(), options: { model:'nori-auto' } })) if (message.type === 'result') results.push(message)
  assert.equal(payloads.length, 2, JSON.stringify(results))
  assert.equal(payloads[0].stream, false)
  assert.ok(payloads[1].tools.some(tool => tool.function.name === 'search_public_web'))
  assert.ok(payloads[1].tools.some(tool => tool.function.name === 'check_pc'))
  assert.equal(results.at(-1)?.subtype, 'success')
  assert.equal(results.at(-1)?.result, 'CONTROLLER_UNION_OK')
})

test('controller rejects unavailable tool and completes the same turn after correction', { timeout: 15000 }, async t => {
  const keys = ['NORI_INFERENCE_RUNTIME','NORI_LOCAL_CHAT','NORI_GPT_OSS_ENABLED','NORI_GPT_OSS_URL','NORI_GPT_OSS_SERVER_MODEL','NORI_GPT_OSS_CONTEXT_TOKENS']
  const saved = Object.fromEntries(keys.map(key => [key, process.env[key]]))
  const payloads = []
  const server = createServer(async (request, response) => {
    let raw = ''; for await (const chunk of request) raw += chunk
    const payload = JSON.parse(raw); payloads.push(payload)
    if (!payload.stream) {
      response.writeHead(200, { 'content-type': 'application/json' })
      // An unavailable choice must retain basic capabilities rather than disable them.
      response.end(JSON.stringify({ choices: [{ message: { tool_calls: [] }, finish_reason: 'stop' }] }))
    } else if (payloads.length === 2) {
      response.writeHead(200, { 'content-type': 'text/event-stream' })
      response.end(`data: ${JSON.stringify({choices:[{delta:{tool_calls:[{index:0,id:'unavailable_fixture',type:'function',function:{name:'unavailable_fixture_tool',arguments:'{}'}}]},finish_reason:'tool_calls'}]})}\n\ndata: [DONE]\n\n`)
    } else {
      const rejected = payload.messages.find(message => message.role === 'tool' && message.tool_call_id === 'unavailable_fixture')
      assert.ok(rejected)
      assert.equal(JSON.parse(rejected.content).executed, false)
      assert.match(JSON.parse(rejected.content).error, /unavailable_fixture_tool.*not available/)
      response.writeHead(200, { 'content-type': 'text/event-stream' })
      response.end('data: {"choices":[{"delta":{"content":"CONTROLLER_UNION_OK"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n')
    }
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(async () => {
    server.closeAllConnections(); await new Promise(resolve => server.close(resolve))
    for (const [key, value] of Object.entries(saved)) { if (value === undefined) delete process.env[key]; else process.env[key] = value }
  })
  Object.assign(process.env, { NORI_INFERENCE_RUNTIME:'gpt-oss', NORI_LOCAL_CHAT:'1', NORI_GPT_OSS_ENABLED:'1',
    NORI_GPT_OSS_URL:`http://127.0.0.1:${server.address().port}`, NORI_GPT_OSS_SERVER_MODEL:'fixture-controller', NORI_GPT_OSS_CONTEXT_TOKENS:'65536' })
  const { query } = await import(`../bridge/nori-v2-query.mjs?union-controller=${Date.now()}`)
  async function* prompt() { yield { message: { content: 'Help me with this task.' } } }
  const results = []
  for await (const message of query({ prompt: prompt(), options: { model:'nori-auto' } })) if (message.type === 'result') results.push(message)
  assert.equal(payloads.length, 3, JSON.stringify(results))
  assert.equal(payloads[0].stream, false)
  assert.ok(payloads[1].tools.some(tool => tool.function.name === 'search_public_web'))
  assert.ok(payloads[1].tools.some(tool => tool.function.name === 'check_pc'))
  assert.equal(results.at(-1)?.subtype, 'success')
  assert.equal(results.at(-1)?.result, 'CONTROLLER_UNION_OK')
})

test('controller executes real isolated catalog reader and receives verified result', { timeout: 15000 }, async t => {
  const keys = ['NORI_ROOT','NORI_INFERENCE_RUNTIME','NORI_LOCAL_CHAT','NORI_GPT_OSS_ENABLED','NORI_GPT_OSS_URL','NORI_GPT_OSS_SERVER_MODEL','NORI_GPT_OSS_CONTEXT_TOKENS']
  const saved = Object.fromEntries(keys.map(key => [key, process.env[key]]))
  const project = mkdtempSync(join(tmpdir(), 'nori-controller-reader-'))
  mkdirSync(join(project,'skills','fixture'),{recursive:true})
  writeFileSync(join(project,'skills','fixture','SKILL.md'),'Synthetic test instruction only.')
  t.after(()=>rmSync(project,{recursive:true,force:true}))
  process.env.NORI_ROOT=project
  const payloads = []
  const server = createServer(async (request, response) => {
    let raw = ''; for await (const chunk of request) raw += chunk
    const payload = JSON.parse(raw); payloads.push(payload)
    if (!payload.stream) {
      response.writeHead(200, { 'content-type': 'application/json' })
      // An unavailable choice must retain basic capabilities rather than disable them.
      response.end(JSON.stringify({ choices: [{ message: { tool_calls: [] }, finish_reason: 'stop' }] }))
    } else if (payloads.length === 2) {
      response.writeHead(200, { 'content-type': 'text/event-stream' })
      response.end(`data: ${JSON.stringify({choices:[{delta:{tool_calls:[{index:0,id:'unavailable_fixture',type:'function',function:{name:'list_skill_catalog',arguments:JSON.stringify({path:'skills'})}}]},finish_reason:'tool_calls'}]})}\n\ndata: [DONE]\n\n`)
    } else {
      const rejected = payload.messages.find(message => message.role === 'tool' && message.tool_call_id === 'unavailable_fixture')
      assert.ok(rejected)
      assert.match(rejected.content, /skills\/fixture\/SKILL.md/)
      assert.match(rejected.content, /not_asserted/)
      assert.doesNotMatch(rejected.content, /No tool ran/)
      response.writeHead(200, { 'content-type': 'text/event-stream' })
      response.end('data: {"choices":[{"delta":{"content":"CONTROLLER_UNION_OK"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n')
    }
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(async () => {
    server.closeAllConnections(); await new Promise(resolve => server.close(resolve))
    for (const [key, value] of Object.entries(saved)) { if (value === undefined) delete process.env[key]; else process.env[key] = value }
  })
  Object.assign(process.env, { NORI_INFERENCE_RUNTIME:'gpt-oss', NORI_LOCAL_CHAT:'1', NORI_GPT_OSS_ENABLED:'1',
    NORI_GPT_OSS_URL:`http://127.0.0.1:${server.address().port}`, NORI_GPT_OSS_SERVER_MODEL:'fixture-controller', NORI_GPT_OSS_CONTEXT_TOKENS:'65536' })
  const { query } = await import(`../bridge/nori-v2-query.mjs?union-controller=${Date.now()}`)
  async function* prompt() { yield { message: { content: 'Help me with this task.' } } }
  const results = []
  for await (const message of query({ prompt: prompt(), options: { model:'nori-auto' } })) if (message.type === 'result') results.push(message)
  assert.equal(payloads.length, 3, JSON.stringify(results))
  assert.equal(payloads[0].stream, false)
  assert.ok(payloads[1].tools.some(tool => tool.function.name === 'search_public_web'))
  assert.ok(payloads[1].tools.some(tool => tool.function.name === 'check_pc'))
  assert.equal(results.at(-1)?.subtype, 'success')
  assert.equal(results.at(-1)?.result, 'CONTROLLER_UNION_OK')
})

test('action-shaped web request reaches tool loop instead of tool-less Core', { timeout: 15000 }, async t => {
  const keys = ['NORI_INFERENCE_RUNTIME','NORI_LOCAL_CHAT','NORI_GPT_OSS_ENABLED','NORI_GPT_OSS_URL','NORI_GPT_OSS_SERVER_MODEL','NORI_GPT_OSS_CONTEXT_TOKENS']
  const saved = Object.fromEntries(keys.map(key => [key, process.env[key]]))
  const payloads = []
  const server = createServer(async (request, response) => {
    let raw = ''; for await (const chunk of request) raw += chunk
    const payload = JSON.parse(raw); payloads.push(payload)
    if (!payload.stream) {
      response.writeHead(200, { 'content-type': 'application/json' })
      // A mistaken direct-answer selection must still retain tools for this live request.
      response.end(JSON.stringify({ choices: [{ message: { tool_calls: [{function:{name:'answer_directly',arguments:'{}'}}] }, finish_reason: 'stop' }] }))
    } else {
      response.writeHead(200, { 'content-type': 'text/event-stream' })
      response.end('data: {"choices":[{"delta":{"content":"CONTROLLER_UNION_OK"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n')
    }
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(async () => {
    server.closeAllConnections(); await new Promise(resolve => server.close(resolve))
    for (const [key, value] of Object.entries(saved)) { if (value === undefined) delete process.env[key]; else process.env[key] = value }
  })
  Object.assign(process.env, { NORI_INFERENCE_RUNTIME:'gpt-oss', NORI_LOCAL_CHAT:'1', NORI_GPT_OSS_ENABLED:'1',
    NORI_GPT_OSS_URL:`http://127.0.0.1:${server.address().port}`, NORI_GPT_OSS_SERVER_MODEL:'fixture-controller', NORI_GPT_OSS_CONTEXT_TOKENS:'65536' })
  const { query } = await import(`../bridge/nori-v2-query.mjs?union-controller=${Date.now()}`)
  async function* prompt() { yield { message: { content: 'Look up the current weather in Boston.' } } }
  const results = []
  for await (const message of query({ prompt: prompt(), options: { model:'nori-auto' } })) if (message.type === 'result') results.push(message)
  assert.equal(payloads.length, 2, JSON.stringify(results))
  assert.equal(payloads[0].stream, false)
  assert.ok(payloads[1].tools.some(tool => tool.function.name === 'search_public_web'))
  assert.ok(payloads[1].tools.some(tool => tool.function.name === 'check_pc'))
  assert.equal(results.at(-1)?.subtype, 'success')
  assert.equal(results.at(-1)?.result, 'CONTROLLER_UNION_OK')
})

test('controller includes measured self status in the answering request', { timeout: 15000 }, async t => {
  const keys = ['NORI_INFERENCE_RUNTIME','NORI_LOCAL_CHAT','NORI_GPT_OSS_ENABLED','NORI_GPT_OSS_URL','NORI_GPT_OSS_SERVER_MODEL','NORI_GPT_OSS_CONTEXT_TOKENS']
  const saved = Object.fromEntries(keys.map(key => [key, process.env[key]]))
  const payloads = []
  const server = createServer(async (request, response) => {
    let raw = ''; for await (const chunk of request) raw += chunk
    const payload = JSON.parse(raw); payloads.push(payload)
    if (!payload.stream) {
      response.writeHead(200, { 'content-type': 'application/json' })
      // An unavailable choice must retain basic capabilities rather than disable them.
      response.end(JSON.stringify({ choices: [{ message: { tool_calls: [{function:{name:'about_nori',arguments:'{}'}}] }, finish_reason: 'stop' }] }))
    } else {
      response.writeHead(200, { 'content-type': 'text/event-stream' })
      response.end('data: {"choices":[{"delta":{"content":"CONTROLLER_UNION_OK"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n')
    }
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(async () => {
    server.closeAllConnections(); await new Promise(resolve => server.close(resolve))
    for (const [key, value] of Object.entries(saved)) { if (value === undefined) delete process.env[key]; else process.env[key] = value }
  })
  Object.assign(process.env, { NORI_INFERENCE_RUNTIME:'gpt-oss', NORI_LOCAL_CHAT:'1', NORI_GPT_OSS_ENABLED:'1',
    NORI_GPT_OSS_URL:`http://127.0.0.1:${server.address().port}`, NORI_GPT_OSS_SERVER_MODEL:'fixture-controller', NORI_GPT_OSS_CONTEXT_TOKENS:'65536' })
  const { query } = await import(`../bridge/nori-v2-query.mjs?union-controller=${Date.now()}`)
  async function* prompt() { yield { message: { content: 'Help me with this task.' } } }
  const results = []
  for await (const message of query({ prompt: prompt(), options: { model:'nori-auto', selfStatus:async ({signal})=>{assert.equal(signal.aborted,false);return 'SELF_STATUS_FIXTURE_64K'} } })) if (message.type === 'result') results.push(message)
  assert.equal(payloads.length, 2, JSON.stringify(results))
  assert.equal(payloads[0].stream, false)
  assert.ok(JSON.stringify(payloads[1].messages).includes('SELF_STATUS_FIXTURE_64K'))
  assert.ok(payloads[1].tools.some(tool => tool.function.name === 'search_public_web'))
  assert.ok(payloads[1].tools.some(tool => tool.function.name === 'check_pc'))
  assert.equal(results.at(-1)?.subtype, 'success')
  assert.equal(results.at(-1)?.result, 'CONTROLLER_UNION_OK')
})

test('controller chooser image selection reaches image handler without a chat fallback', { timeout: 15000 }, async t => {
  const keys = ['NORI_INFERENCE_RUNTIME','NORI_LOCAL_CHAT','NORI_GPT_OSS_ENABLED','NORI_GPT_OSS_URL','NORI_GPT_OSS_SERVER_MODEL','NORI_GPT_OSS_CONTEXT_TOKENS']
  const saved = Object.fromEntries(keys.map(key => [key, process.env[key]]))
  const payloads = []
  const server = createServer(async (request, response) => {
    let raw = ''; for await (const chunk of request) raw += chunk
    const payload = JSON.parse(raw); payloads.push(payload)
    if (!payload.stream) {
      response.writeHead(200, { 'content-type': 'application/json' })
      // Exercise semantic image selection without a keyword image request or a real generator.
      response.end(JSON.stringify({ choices: [{ message: { tool_calls: [{ function: { name: 'generate_image', arguments: '{}' } }] }, finish_reason: 'stop' }] }))
    } else {
      response.writeHead(200, { 'content-type': 'text/event-stream' })
      response.end('data: {"choices":[{"delta":{"content":"CONTROLLER_UNION_OK"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n')
    }
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(async () => {
    server.closeAllConnections(); await new Promise(resolve => server.close(resolve))
    for (const [key, value] of Object.entries(saved)) { if (value === undefined) delete process.env[key]; else process.env[key] = value }
  })
  Object.assign(process.env, { NORI_INFERENCE_RUNTIME:'gpt-oss', NORI_LOCAL_CHAT:'1', NORI_GPT_OSS_ENABLED:'1',
    NORI_GPT_OSS_URL:`http://127.0.0.1:${server.address().port}`, NORI_GPT_OSS_SERVER_MODEL:'fixture-controller', NORI_GPT_OSS_CONTEXT_TOKENS:'65536' })
  const { query } = await import(`../bridge/nori-v2-query.mjs?union-controller=${Date.now()}`)
  async function* prompt() { yield { message: { content: 'Help me with this task.' } } }
  const results = []
  for await (const message of query({ prompt: prompt(), options: { model:'nori-auto' } })) if (message.type === 'result') results.push(message)
  assert.equal(payloads.length, 1, JSON.stringify(results))
  assert.equal(payloads[0].stream, false)
  assert.equal(results.at(-1)?.error_code, 'NORI_LOCAL_IMAGE_FAILED')
  assert.match(results.at(-1)?.errors.join(' '), /image display is not connected/)
  assert.ok(!results.some(result => result.subtype === 'success'))
})

test('GPT-OSS creative operations use the local app broker, not the general Council work service', async t => {
  const saved=Object.fromEntries(['NORI_INFERENCE_RUNTIME','NORI_LOCAL_CHAT'].map(key=>[key,process.env[key]]))
  t.after(()=>{for(const [key,value] of Object.entries(saved)){if(value===undefined)delete process.env[key];else process.env[key]=value}})
  process.env.NORI_INFERENCE_RUNTIME='gpt-oss'
  process.env.NORI_LOCAL_CHAT='1'
  const {usesLocalChatRoute}=await import('../bridge/nori-v2-query.mjs')
  for(const app of ['PhotoCraft','VectorCraft','FilmCraft','LightCraft','PDFCraft','EffectCraft','DesignCraft','FigCraft','WordCraft','SoundCraft','DeckCraft','CADCraft','GridCraft'])
    assert.equal(usesLocalChatRoute({goal:`Use ${app} to create a new project.`}),true,app)
  assert.equal(usesLocalChatRoute({goal:'Create a document containing a test marker.'}),true)
  process.env.NORI_LOCAL_CHAT='0'
  assert.equal(usesLocalChatRoute({goal:'Use WordCraft to create a document.'}),false)
})

test('disconnected image display reports failure and the next turn still works',async()=>{
  const {query}=await import(`../bridge/nori-v2-query.mjs?image-disconnected=${Date.now()}`)
  async function* prompt(){
    yield {message:{content:'Generate an image of a blue car.'}}
    yield {message:{content:'Turn the interface ghost purple.'}}
  }
  const ui=[];const results=[]
  for await(const message of query({prompt:prompt(),options:{nativeUi:(op,args)=>ui.push({op,args})}})){
    if(message.type==='result')results.push(message)
  }
  assert.equal(results.length,2)
  assert.equal(results[0].subtype,'error_during_execution')
  assert.match(results[0].errors.join(' '),/display is not connected/)
  assert.equal(results[1].result,'Done.')
  assert.equal(ui.length,1)
  assert.ok(!results.some(result=>result.result?.includes('I made it')))
})

test('current local attachment stays in the required user turn when optional workspace background is dropped', async (t) => {
  const received = []
  await nativeChatFixture(t, received)
  const { query } = await import(`../bridge/nori-v2-query.mjs?required-attachment=${Date.now()}`)
  const attachment = encodeNeuraleseAttachment({ filename: 'nori-local-attachment-probe.txt',
    text: 'Expected payload marker: NORI_LOCAL_ATTACHMENT_OK' }, { turnId: 'ask-local-attachment-1' })
  const optionalContext = `[Open tabs: ${'optional-pane-note '.repeat(600)}]`
  async function* prompt() {
    yield { message: { role: 'user', content: 'Summarize the attached file.' },
      nori_context: optionalContext, nori_attachment: attachment }
  }
  const messages = []
  for await (const message of query({ prompt: prompt() })) messages.push(message)
  assert.equal(messages.at(-1).subtype, 'success')
  assert.equal(received.length, 1)
  const userContent = received[0].messages.filter(message => message.role === 'user').map(message => message.content).join('\n')
  assert.match(userContent, /nori-local-attachment-probe\.txt/)
  assert.match(userContent, /NORI_LOCAL_ATTACHMENT_OK/)
  assert.match(userContent, /Summarize the attached file\./)
  assert.doesNotMatch(userContent, /optional-pane-note/)
})

test('native adapter refuses unqualified work without submitting to Council', async (t) => {
  const saved=Object.fromEntries(['NORI_COUNCIL_URL','NORI_API_TOKEN','NORI_POLL_MS'].map(key=>[key,process.env[key]]))
  t.after(()=>{for(const [key,value] of Object.entries(saved)){if(value===undefined)delete process.env[key];else process.env[key]=value}})
  const token = 'test-token-that-is-definitely-longer-than-thirty-two-characters'
  let polls = 0
  let requests = 0
  let submitted = null
  const server = createServer(async (request, response) => {
    requests++
    assert.equal(request.headers.authorization, `Bearer ${token}`)
    response.setHeader('content-type', 'application/json')
    if (request.method === 'POST' && request.url === '/work') {
      let body = ''
      for await (const chunk of request) body += chunk
      submitted = JSON.parse(body)
      response.end(JSON.stringify({ task_id: 'work-1', status: 'queued' }))
      return
    }
    if (request.method === 'GET' && request.url === '/work/work-1') {
      polls++
      response.end(JSON.stringify(polls < 2
        ? { task_id: 'work-1', status: 'running' }
        : { task_id: 'work-1', status: 'completed', response: 'NORI_NATIVE_OK' }))
      return
    }
    response.statusCode = 404
    response.end(JSON.stringify({ error: 'not found' }))
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  t.after(() => server.close())

  const address = server.address()
  process.env.NORI_COUNCIL_URL = `http://127.0.0.1:${address.port}`
  process.env.NORI_API_TOKEN = token
  process.env.NORI_POLL_MS = '1'
  const { query } = await import(`../bridge/nori-v2-query.mjs?test=${Date.now()}`)

  async function* prompt() {
    yield { message: { content: [{ type: 'text', text: '*work prove the native route' }] } }
  }
  const oldReady=process.env.NORI_NATIVE_CORE_READY
  t.after(()=>{if(oldReady===undefined)delete process.env.NORI_NATIVE_CORE_READY;else process.env.NORI_NATIVE_CORE_READY=oldReady})
  for(const ready of ['0','1']) {
    process.env.NORI_NATIVE_CORE_READY=ready
    const messages=[]
    for await(const message of query({prompt:prompt(),options:{allowWrites:true}}))messages.push(message)
    assert.equal(submitted,null)
    assert.equal(polls,0)
    assert.equal(requests,0)
    assert.equal(messages.at(-1).error_code,ready==='1'?'NORI_NATIVE_TOOLS_UNQUALIFIED':'NORI_NATIVE_CORE_UNAVAILABLE')
    assert.deepEqual(messages.filter(m=>m.type==='neural-event').map(m=>m.state),['started','allowed'])
    assert.ok(!messages.some(m=>m.type==='result' && m.subtype==='success'))
  }
})

test('GPT-OSS keeps durable work gated while distinguishing foreground tools', async (t) => {
  const names = ['NORI_INFERENCE_RUNTIME', 'NORI_NATIVE_CORE_READY', 'NORI_API_TOKEN']
  const previous = Object.fromEntries(names.map(name => [name, process.env[name]]))
  const originalFetch = globalThis.fetch
  let dispatches = 0
  // Catch any attempted dispatch without contacting Core or loading its token.
  globalThis.fetch = async () => { dispatches++; throw new Error('Synthetic unexpected durable dispatch') }
  process.env.NORI_INFERENCE_RUNTIME = 'gpt-oss'
  process.env.NORI_API_TOKEN = 'fixture-durable-token-not-a-production-credential'
  t.after(() => {
    globalThis.fetch = originalFetch
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[name]
      else process.env[name] = value
    }
  })
  const { query } = await import(`../bridge/nori-v2-query.mjs?gpt-oss-chat-only=${Date.now()}`)
  for (const ready of ['0', '1']) {
    process.env.NORI_NATIVE_CORE_READY = ready
    async function* prompt() { yield { message: { content: '*work change a file' } } }
    const messages = [], saved = []
    for await (const message of query({ prompt: prompt(), options: {
      allowWrites: true, onConversationUpdate: turns => saved.push(turns),
    } })) messages.push(message)
    assert.equal(messages.at(-1).subtype, 'error_during_execution')
    assert.equal(messages.at(-1).error_code, 'NORI_GPT_OSS_CHAT_ONLY')
    assert.equal(typeof messages.at(-1).errors[0], 'string')
    assert.equal(messages.some(message => message.type === 'neural-event' || message.subtype === 'success'), false)
    assert.deepEqual(saved, [])
  }
  assert.equal(dispatches, 0, 'Neither unavailable nor ready Core may receive an unqualified durable task')
})

test('GPT-OSS capability requests can inspect Nori skills through Neuralese read tools only', async (t) => {
  const names = ['NORI_INFERENCE_RUNTIME', 'NORI_LOCAL_CHAT', 'NORI_GPT_OSS_ENABLED', 'NORI_GPT_OSS_URL', 'NORI_GPT_OSS_SERVER_MODEL', 'NORI_ROOT']
  const previous = Object.fromEntries(names.map(name => [name, process.env[name]]))
  const { mkdtempSync, mkdirSync, writeFileSync, rmSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const root = mkdtempSync(join(tmpdir(), 'nori-capability-route-'))
  mkdirSync(join(root, 'skills', 'incoming', 'vercel-agent-skills', 'skills', 'react-best-practices'), { recursive: true })
  mkdirSync(join(root, 'skills', 'nori-linux-graphics-investigator'), { recursive: true })
  writeFileSync(join(root, 'skills', 'nori-linux-graphics-investigator', 'skill.json'), JSON.stringify({
    schema: 'nori.skill-candidate.v1', name: 'nori-linux-graphics-investigator',
    status: 'candidate', authority: 'none', execution: 'plan_only',
  }))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const requests = []
  const server = createServer(async (request, response) => {
    let body = ''
    for await (const chunk of request) body += chunk
    const payload = JSON.parse(body)
    requests.push(payload)
    response.writeHead(200, { 'content-type': 'text/event-stream' })
    if (requests.length <= 2) {
      const calls = requests.length === 1 ? [
        ['list_skill_catalog', { path: 'skills' }],
      ] : [
        ['read_file', { path: 'skills/nori-linux-graphics-investigator/skill.json' }],
      ]
      const toolCalls = calls.map(([name, args], index) => ({ index,
        id: `call_skill_inventory_${requests.length}`, type: 'function',
        function: { name, arguments: JSON.stringify(args) } }))
      response.end(`data: ${JSON.stringify({ choices: [{ delta: { tool_calls: toolCalls } }] })}\n\ndata: [DONE]\n\n`)
      return
    }
    response.end(`data: ${JSON.stringify({ choices: [{ delta: { content: 'READ_ONLY_CAPABILITY_REVIEW_COMPLETE' } }] })}\n\ndata: [DONE]\n\n`)
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  process.env.NORI_INFERENCE_RUNTIME = 'gpt-oss'
  process.env.NORI_LOCAL_CHAT = '1'
  process.env.NORI_GPT_OSS_ENABLED = '1'
  process.env.NORI_GPT_OSS_URL = `http://127.0.0.1:${server.address().port}`
  process.env.NORI_GPT_OSS_SERVER_MODEL = 'fixture-gpt-oss'
  process.env.NORI_ROOT = root
  t.after(async () => {
    await new Promise(resolve => server.close(resolve))
    for (const name of names) {
      if (previous[name] === undefined) delete process.env[name]
      else process.env[name] = previous[name]
    }
  })
  const { query } = await import(`../bridge/nori-v2-query.mjs?gpt-oss-capability-read=${Date.now()}`)
  async function* prompt() { yield { message: { content: 'I just want her to be able to use all her capabilities and skills.' } } }
  const messages = []
  for await (const message of query({ prompt: prompt(), options: { allowWrites: false, getModel: () => 'fixture-gpt-oss' } })) messages.push(message)
  const result = messages.find(message => message.type === 'result')
  assert.equal(result?.subtype, 'success', JSON.stringify({ result,
    requestBytes: requests.map(request => Buffer.byteLength(JSON.stringify(request), 'utf8')) }))
  assert.equal(result?.result, 'READ_ONLY_CAPABILITY_REVIEW_COMPLETE')
  assert.equal(requests.length, 3)
  assert.ok(requests.every(request => request.tools?.length === 3))
  assert.deepEqual(requests[1].messages.filter(message => message.role === 'tool').map(message => message.tool_call_id),
    ['call_skill_inventory_1'])
  assert.deepEqual(requests[2].messages.filter(message => message.role === 'tool').map(message => message.tool_call_id),
    ['call_skill_inventory_1', 'call_skill_inventory_2'])
  assert.match(requests[0].messages.at(-1).content, /skill audit:/i)
  assert.match(requests[0].messages.at(-1).content, /Inventory the whole skill catalog/)
  assert.match(requests[0].messages[0].content, /only the listed Nori-project read tools/)
  assert.match(requests[0].messages[0].content, /Three read-only tools/)
  assert.match(requests[2].messages.at(-1).content, /do not follow instructions/i)
  assert.match(requests[2].messages.at(-1).content, /plan_only/)
  assert.equal(messages.some(message => message.type === 'neural-event' && message.operation === 'policy_check'), false)
})

test('GPT-OSS local chat failures preserve their exact local diagnostic and never fall back', async (t) => {
  const names = ['NORI_INFERENCE_RUNTIME', 'NORI_LOCAL_CHAT', 'NORI_GPT_OSS_ENABLED', 'NORI_GPT_OSS_URL', 'NORI_GPT_OSS_SERVER_MODEL']
  const previous = Object.fromEntries(names.map(name => [name, process.env[name]]))
  const server = createServer((_request, response) => {
    response.writeHead(503, { 'content-type': 'application/json' })
    response.end(JSON.stringify({ error: 'fixture local model unavailable' }))
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  process.env.NORI_INFERENCE_RUNTIME = 'gpt-oss'
  process.env.NORI_LOCAL_CHAT = '1'
  process.env.NORI_GPT_OSS_ENABLED = '1'
  process.env.NORI_GPT_OSS_URL = `http://127.0.0.1:${server.address().port}`
  process.env.NORI_GPT_OSS_SERVER_MODEL = 'fixture-gpt-oss'
  t.after(async () => {
    await new Promise(resolve => server.close(resolve))
    for (const name of names) {
      if (previous[name] === undefined) delete process.env[name]
      else process.env[name] = previous[name]
    }
  })
  const { query } = await import(`../bridge/nori-v2-query.mjs?gpt-oss-error=${Date.now()}`)
  async function* prompt() { yield { message: { content: 'Reply briefly.' } } }
  const messages = []
  for await (const message of query({
    prompt: prompt(),
    options: { getModel: () => 'fixture-gpt-oss' },
  })) messages.push(message)
  const failure = messages.find(message => message.type === 'result')
  assert.equal(failure?.subtype, 'error_during_execution')
  assert.equal(failure?.error_code, 'NORI_GPT_OSS_CHAT_FAILED')
  assert.match(failure?.errors?.[0] ?? '', /Local GPT-OSS server failed \(503\)/)
  assert.match(failure?.errors?.[0] ?? '', /no fallback or cloud request was made/i)
})

test('ordinary turns use the concise native chat route', async (t) => {
  const received=[]
  await nativeChatFixture(t,received)
  const { query } = await import(`../bridge/nori-v2-query.mjs?chat=${Date.now()}`)
  const ui = []
  async function* prompt() {
    yield { message: { content: [{ type: 'text', text: 'Tell me something about purple.' }] } }
  }
  const messages = []
  for await (const message of query({
    prompt: prompt(),
    options: { nativeUi: (op, args) => ui.push({ op, args }) },
  })) messages.push(message)
  assert.equal(received.length,1)
  assert.equal(received[0].model_id,'fixture-native-model')
  assert.equal(received[0].stream,true)
  assert.equal(received[0].messages.at(-1).content,'Tell me something about purple.')
  assert.equal(messages.at(-1).result, 'NORI_CHAT_OK')
  assert.deepEqual(ui, [])
  const observations=messages.filter(message=>message.type==='neural-event')
  assert.deepEqual(observations.map(event=>[event.operation,event.state]),[['context_update','started'],['context_update','completed']])
  assert.equal(observations[0].operation_id,observations[1].operation_id)
  const ledger=createNeuralEventLedger('fixture-turn')
  clearNeuralSignals()
  for(const [index,event] of observations.entries()) {
    // The bridge binds its accepted turn before handing the event to the consumer.
    observeBridgeNeuralSignal({...event,ask:'fixture-turn'},'fixture-turn',1000+index*1100,ledger)
  }
  assert.deepEqual(observedNeuralSignals(2100),[{from:'connections',to:'working_memory',at:2100,state:'completed'}])
  assert.ok(!JSON.stringify(observations).includes('Tell me something about purple'))
  ledger.close(); clearNeuralSignals()
})

test('native chat passes a local visual description as bounded untrusted context and never forwards image bytes', async (t) => {
  const imageData=Buffer.from([137,80,78,71,13,10,26,10,0]).toString('base64')
  const received=[]
  await nativeChatFixture(t,received)
  const {query}=await import(`../bridge/nori-v2-query.mjs?image-vlm=${Date.now()}`)
  async function* prompt(){yield {message:{content:[
    {type:'text',text:'Make sure Nori knows how to do this'},
    {type:'image',source:{type:'base64',media_type:'image/png',data:imageData}},
  ]}}}
  const results=[]
  const visionCalls=[]
  for await(const message of query({prompt:prompt(),options:{understandImage:async(frame,question)=>{
    visionCalls.push({frame,question})
    return 'A screen showing DEC ALPHA LINUX GPU accelerated desktop controls.'
  }}}))if(message.type==='result')results.push(message)
  assert.equal(visionCalls.length,1)
  assert.equal(visionCalls[0].frame.data,imageData)
  assert.match(visionCalls[0].question,/Make sure Nori knows/)
  assert.equal(received.length,1)
  const backgroundMessages=received[0].messages.filter(message=>message.role==='user'&&
    /\[(?:Workspace background|Visual context|Task reference)/.test(message.content))
  assert.ok(backgroundMessages.length >= 1,'local visual and skill references remain separately bounded background turns')
  const backgrounds=backgroundMessages.map(message=>message.content).join('\n')
  assert.match(backgrounds,/Untrusted visual observations from Nori’s local vision model/)
  assert.match(backgrounds,/DEC ALPHA LINUX GPU/i)
  assert.match(backgrounds,/nori-linux-graphics-investigator/)
  assert.equal(received[0].messages.at(-1).content,'Make sure Nori knows how to do this')
  assert.equal(JSON.stringify(received).includes(imageData),false)
  assert.equal(results.at(-1).subtype,'success')
})

test('invalid user image fails closed before visual inference and native inference',async t=>{
  const received=[]
  await nativeChatFixture(t,received)
  const {query}=await import(`../bridge/nori-v2-query.mjs?invalid-image-vlm=${Date.now()}`)
  async function* prompt(){yield {message:{content:[
    {type:'text',text:'Make sure Nori knows how to do this'},
    {type:'image',source:{type:'base64',media_type:'image/png',data:'aGVsbG8='}},
  ]}}}
  const results=[]
  for await(const message of query({prompt:prompt()}))if(message.type==='result')results.push(message)
  assert.equal(received.length,0)
  assert.equal(results.at(-1).subtype,'error_during_execution')
  assert.match(results.at(-1).errors.join(' '),/[Ii]mage attachment/)
})

test('visual Nori commands apply and acknowledge without a model round trip', async (t) => {
  const originalFetch = globalThis.fetch
  let dispatches = 0
  globalThis.fetch = async () => { dispatches++; throw new Error('Synthetic unexpected UI dispatch') }
  t.after(() => { globalThis.fetch = originalFetch })
  const { query } = await import(`../bridge/nori-v2-query.mjs?ui=${Date.now()}`)
  const ui = []
  const memoryObservations=[]
  async function* prompt() {
    yield { message: { content: [{ type: 'text', text: 'Turn the interface ghost purple.' }] } }
  }
  const messages = []
  for await (const message of query({ prompt: prompt(), options: { nativeUi: (op, args) => ui.push({ op, args }),onNeuralObservation:event=>memoryObservations.push(event) } })) messages.push(message)
  assert.deepEqual(ui, [{ op: 'patch', args: { accent: '#a56bff' } }])
  assert.equal(messages.at(-1).result, 'Done.')
  assert.deepEqual(memoryObservations, [], 'a direct UI action needs no memory lookup')
  assert.equal(dispatches, 0, 'A completed local UI action must not contact a model or work service')
})

test('closing during context assembly emits no completion and makes no inference request', async (t) => {
  const received=[]
  await nativeChatFixture(t,received)
  const {query}=await import(`../bridge/nori-v2-query.mjs?context-close=${Date.now()}`)
  async function* prompt(){yield {message:{content:'Tell me about purple.'}}}
  const stream=query({prompt:prompt()})
  assert.equal((await stream.next()).value.type,'system')
  const started=(await stream.next()).value
  assert.equal(started.operation,'context_update')
  assert.equal(started.state,'started')
  stream.close()
  assert.equal((await stream.next()).done,true)
  assert.deepEqual(received,[])
})

test('interrupting before context assembly cancels it and preserves the next turn', async (t) => {
  const received=[]
  await nativeChatFixture(t,received)
  const {query}=await import(`../bridge/nori-v2-query.mjs?context-interrupt=${Date.now()}`)
  async function* prompt(){
    yield {message:{content:'Tell me about purple.'}}
    yield {message:{content:'Turn the interface ghost purple.'}}
  }
  const ui=[]
  const stream=query({prompt:prompt(),options:{nativeUi:(op,args)=>ui.push({op,args})}})
  await stream.next()
  const started=(await stream.next()).value
  assert.equal(started.state,'started')
  await stream.interrupt()
  const messages=[]
  for await(const message of stream)messages.push(message)
  const terminal=messages.find(m=>m.type==='neural-event')
  assert.equal(terminal.operation_id,started.operation_id)
  assert.equal(terminal.state,'cancelled')
  assert.equal(messages.find(m=>m.type==='result').subtype,'error_during_execution')
  assert.equal(messages.at(-1).result,'Done.')
  assert.equal(ui.length,1)
  assert.deepEqual(received,[])
})

test('a restored Nori session keeps its identity and recent local context', async () => {
  const { query } = await import(`../bridge/nori-v2-query.mjs?restore=${Date.now()}`)
  async function* prompt() { /* restored session can start before the next turn */ }
  const messages = []
  for await (const message of query({
    prompt: prompt(),
    options: {
      conversationId: 'nori-unified-restored-session',
      initialTurns: [{ role: 'user', text: 'Keep the orb ghost purple.' }, { role: 'nori', text: 'Done.' }],
    },
  })) messages.push(message)
  assert.equal(messages[0].session_id, 'nori-unified-restored-session')
})

for (const boundary of ['context-completed','response-delta']) {
  test(`interrupt at ${boundary} cannot save or report a successful reply`,async(t)=>{
    const received=[]
    await nativeChatFixture(t,received)
    const {query}=await import(`../bridge/nori-v2-query.mjs?interrupt-boundary=${boundary}-${Date.now()}`)
    async function* prompt(){yield {message:{content:'Tell me about purple.'}}}
    const saved=[]
    const stream=query({prompt:prompt(),options:{onConversationUpdate:turns=>saved.push(turns)}})
    const messages=[]
    while(true) {
      const next=await stream.next()
      assert.equal(next.done,false)
      messages.push(next.value)
      if(boundary==='context-completed'
        ? next.value.type==='neural-event' && next.value.state==='completed'
        : next.value.type==='stream_event')break
    }
    await stream.interrupt()
    for await(const message of stream)messages.push(message)
    assert.deepEqual(messages.filter(m=>m.type==='neural-event').map(m=>m.state),['started','completed'])
    assert.equal(messages.at(-1).subtype,'error_during_execution')
    assert.match(messages.at(-1).errors.join(' '),/stopped|timed out/)
    assert.ok(!messages.some(m=>m.type==='result' && m.subtype==='success'))
    assert.deepEqual(saved,[])
    assert.equal(received.length,boundary==='context-completed'?0:1)
  })
}

test('follow-up turns carry the recent conversation as background', async (t) => {
  const received = []
  await nativeChatFixture(t,received,'Got it.')
  const { query } = await import(`../bridge/nori-v2-query.mjs?followup=${Date.now()}`)
  async function* prompt() {
    yield { message: { content: [{ type: 'text', text: 'Tell me about the color purple.' }] } }
    yield { message: { content: [{ type: 'text', text: 'And a darker shade?' }] } }
  }
  for await (const _message of query({ prompt: prompt() })) { /* consume */ }
  assert.equal(received.length,2)
  assert.equal(received[0].messages.at(-1).content,'Tell me about the color purple.')
  assert.deepEqual(received[1].messages.slice(-3),[
    {role:'user',content:'Tell me about the color purple.'},
    {role:'assistant',content:'Got it.'},
    {role:'user',content:'And a darker shade?'},
  ])
})

test('verified Neuralese intent repairs one-copy ingress drift before local-model handoff', async (t) => {
  const received = []
  await nativeChatFixture(t, received, 'Intent preserved.')
  const { query } = await import(`../bridge/nori-v2-query.mjs?neuralese-ingress=${Date.now()}`)
  const intended = 'Please inspect the exact Nori capability boundary.'
  async function* prompt() {
    yield {
      message: { content: 'Please inspect the exact Nori capability boundari.' },
      neuralese_intent: encodeNeuraleseIntent(intended, { turnId: 'ingress-verified-1' }),
    }
  }
  for await (const _message of query({ prompt: prompt() })) { /* consume */ }
  assert.equal(received.length, 1)
  assert.equal(received[0].messages.at(-1).content, intended)
})

test('REA deadline covers bounded Ghidra startup and exact pending path follow-ups',async()=>{
 const {localReplyTimeoutMs}=await import('../bridge/nori-v2-query.mjs')
 const file=String.raw`C:\Nori\synthetic-deadline-only.exe`
 assert.equal(localReplyTimeoutMs('Use REA to inspect "'+file+'".'),600000)
 assert.equal(localReplyTimeoutMs(file,[{role:'user',text:'rea the Discord app'}]),600000)
 assert.equal(localReplyTimeoutMs(file,[{role:'user',text:'rea the Discord app'},{role:'user',text:'cancel that'}]),120000)
 assert.equal(localReplyTimeoutMs(file,[]),120000)
 assert.equal(localReplyTimeoutMs('hello'),120000)
})
