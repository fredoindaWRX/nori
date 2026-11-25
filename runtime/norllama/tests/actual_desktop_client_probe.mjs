import assert from 'node:assert/strict'
import { nativeRuntimeChat } from '../../../apps/desktop/bridge/native-runtime.mjs'
import { localChat } from '../../../apps/desktop/bridge/local-chat.mjs'
const endpoint = process.env.NORI_TEST_ENDPOINT
const apiKey = process.env.NORI_TEST_KEY
const modelId = 'llama3.2-3b-instruct'
assert.ok(endpoint && apiKey)
const messages = [{ role: 'user', content: 'Say hello.' }]
const initialHealth = await fetch(`${endpoint}/health`, {
  headers: { Authorization: `Bearer ${apiKey}` }, signal: AbortSignal.timeout(3000),
}).then(response => response.json())
let output = ''
for await (const text of nativeRuntimeChat({ endpoint, apiKey, modelId, messages, maxTokens: 4 })) output += text
assert.equal(output, 'Hello!')
const abort = new AbortController()
const stream = nativeRuntimeChat({ endpoint, apiKey, modelId,
  messages: [{ role: 'user', content: 'Write a long detailed story about space exploration.' }],
  maxTokens: 200, signal: abort.signal })
const first = await stream.next()
assert.equal(first.done, false)
abort.abort()
await assert.rejects(stream.next(), { name: 'AbortError' })
await stream.return()
const health = async () => {
  const response = await fetch(`${endpoint}/health`, { headers: { Authorization: `Bearer ${apiKey}` } })
  return response.json()
}
const deadline = Date.now() + 5000
while ((await health()).active_request_id !== null && Date.now() < deadline) {
  await new Promise(resolve => setTimeout(resolve, 50))
}
assert.equal((await health()).active_request_id, null)
Object.assign(process.env, { NORI_INFERENCE_RUNTIME: 'norllama', NORI_RUNTIME_URL: endpoint,
  NORI_RUNTIME_API_KEY: apiKey, NORI_RUNTIME_MODEL_ID: modelId, NORI_LOCAL_CHAT: '1',
  NORI_LEARNING_FILE: new URL('./nonexistent-probe-memory.json', import.meta.url).pathname })
let contextual = ''
for await (const text of localChat({ goal: 'Just say hello.', turns: [], profile: 'lightning-fast' })) contextual += text
assert.ok(contextual.trim().length > 0)
const profiles = ['lightning-fast']
for (const profile of ['balanced', 'deep']) {
  let answer = ''
  for await (const text of localChat({ goal: 'Just say hello.', turns: [], profile, modelSelection: modelId })) answer += text
  assert.ok(answer.trim().length > 0)
  profiles.push(profile)
}
assert.ok((await health()).ready)
assert.equal((await health()).worker_pid, initialHealth.worker_pid)
for (const modelSelection of ['qwen3.5:4b', 'qwen3.5:9b', 'gpt-oss:20b']) {
  await assert.rejects(async () => {
    for await (const text of localChat({ goal: 'hello', turns: [], modelSelection })) void text
  }, /no model substitution/)
}
// Exercise Nori's real turn adapter, not just its HTTP client. No durable work,
// live tools, preference writes or owner's existing memory file are involved.
const { query } = await import('../../../apps/desktop/bridge/nori-v2-query.mjs')
async function* prompt() { yield { message: { content: 'Just say hello.' } } }
let adapterAnswer = ''
let adapterResult
let remembered
for await (const message of query({ prompt: prompt(), options: {
  model: modelId, responseProfile: 'balanced', allowWrites: false,
  onConversationUpdate: turns => { remembered = turns },
} })) {
  if (message.type === 'stream_event') adapterAnswer += message.event?.delta?.text || ''
  if (message.type === 'result') adapterResult = message
}
assert.equal(adapterResult?.subtype, 'success')
assert.ok(adapterAnswer.trim())
assert.equal(adapterResult.result, adapterAnswer)
assert.equal(remembered?.at(-1)?.text, adapterAnswer)
async function* longPrompt() { yield { message: { content: 'Write a long detailed story about space exploration.' } } }
const interrupted = query({ prompt: longPrompt(), options: {
  model: modelId, responseProfile: 'deep', allowWrites: false,
} })
let interruptedAfterToken = false
let interruptedResult
for await (const message of interrupted) {
  if (!interruptedAfterToken && message.type === 'stream_event' && message.event?.delta?.text) {
    interruptedAfterToken = true
    await interrupted.interrupt()
  }
  if (message.type === 'result') interruptedResult = message
}
assert.ok(interruptedAfterToken)
assert.equal(interruptedResult?.subtype, 'error_during_execution')
const stopDeadline = Date.now() + 5000
while ((await health()).active_request_id !== null && Date.now() < stopDeadline) {
  await new Promise(resolve => setTimeout(resolve, 50))
}
assert.equal((await health()).active_request_id, null)
assert.equal((await health()).worker_pid, initialHealth.worker_pid)
console.log(JSON.stringify({ desktop_native_client: 'PASS', direct_text: output,
  active_abort_and_quiescence: 'PASS', nori_persona_chat: 'PASS', persona_reply_characters: contextual.length,
  actual_response_profiles: profiles, native_turn_adapter: 'PASS', native_adapter_interrupt: 'PASS', unavailable_model_refusal: 'PASS' }))
