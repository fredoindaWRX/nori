import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { cloudToolDriver, withLocalFallback } from '../bridge/cloud-tools.mjs'
import { openAISetting, writeOpenAISettings } from '../bridge/openai-route.mjs'
import { agentToolLoop } from '../bridge/agent-loop.mjs'
import { composeToolUnion } from '../bridge/tool-registry.mjs'

const env = { OPENAI_API_KEY: 'test-key' }
const rootWith = settings => { const root = mkdtempSync(join(tmpdir(), 'nori-cloud-tools-')); if (settings) writeOpenAISettings(root, settings); return root }
const sse = (delta, usage) => new Response(`data: ${JSON.stringify({ choices: [{ delta, finish_reason: delta.tool_calls ? 'tool_calls' : 'stop' }] })}\n\n`
  + `data: ${JSON.stringify({ choices: [], usage })}\n\ndata: [DONE]\n\n`, { status: 200 })

test('GPT drives tools only while OpenAI and its tools setting are on, a key reaches Nori and the cap has room', () => {
  assert.equal(cloudToolDriver({ root: rootWith(null), environment: env }), null)
  assert.equal(cloudToolDriver({ root: rootWith({ enabled: true, tools: false }), environment: env }), null)
  assert.equal(cloudToolDriver({ root: rootWith({ enabled: true }), environment: {} }), null)
  assert.equal(cloudToolDriver({ root: rootWith({ enabled: true, dailyUsd: 0 }), environment: env }), null)
  const driver = cloudToolDriver({ root: rootWith({ enabled: true }), environment: env })
  assert.equal(driver.endpoint, 'https://api.openai.com')
  assert.equal(driver.modelId, 'gpt-5-mini')
  assert.equal(driver.label, 'GPT')
  assert.deepEqual(openAISetting('keep tools local'), { tools: false })
  assert.deepEqual(openAISetting('give gpt the tools'), { enabled: true, tools: true })
})

test('a GPT-driven tool turn: tools run here, the request is translated for OpenAI, and spend is recorded', async () => {
  const root = rootWith({ enabled: true })
  const sent = [], ran = []
  const replies = [
    sse({ tool_calls: [{ index: 0, id: 'c1', function: { name: 'inspect', arguments: '{"item":"disk"}' } }] }, { prompt_tokens: 1000, completion_tokens: 100 }),
    sse({ content: 'Disk is fine.' }, { prompt_tokens: 1200, completion_tokens: 50 }),
  ]
  const fetchImpl = async (url, init) => { sent.push({ url, init, body: JSON.parse(init.body) }); return replies.shift() }
  const driver = cloudToolDriver({ root, environment: env, fetchImpl })
  const definition = { type: 'function', function: { name: 'inspect', parameters: { type: 'object', properties: { item: { type: 'string' } }, required: ['item'], additionalProperties: false } } }
  const tools = composeToolUnion([{ key: 'project', tools: { definitions: [definition], call: (_n, args) => { ran.push(args.item); return '{"ok":true}' } } }])
  let text = ''
  for await (const part of agentToolLoop({ endpoint: driver.endpoint, modelId: driver.modelId, fetcher: driver.fetcher,
    messages: [{ role: 'system', content: 'Nori' }, { role: 'user', content: 'check my disk' }], maxTokens: 1024,
    tools, contextTokens: driver.contextTokens })) text += part
  assert.equal(text, 'Disk is fine.')
  assert.deepEqual(ran, ['disk'])
  assert.equal(sent.length, 2)
  assert.equal(sent[0].url, 'https://api.openai.com/v1/chat/completions')
  assert.equal(sent[0].init.headers.authorization, 'Bearer test-key')
  assert.equal(sent[0].init.redirect, 'error')
  assert.equal(sent[0].body.model, 'gpt-5-mini')
  assert.equal(sent[0].body.chat_template_kwargs, undefined)
  assert.equal(sent[0].body.max_tokens, undefined)
  assert.ok(sent[0].body.max_completion_tokens >= 4096)
  assert.deepEqual(sent[0].body.stream_options, { include_usage: true })
  assert.ok(sent[0].body.tools.some(tool => tool.function.name === 'inspect'))
  const log = readFileSync(join(root, 'learning', 'openai-usage.jsonl'), 'utf8').trim().split('\n')
  assert.equal(log.length, 2)
  assert.doesNotMatch(log.join('\n'), /test-key|disk/)
  // Any other URL is refused before a request is made.
  await assert.rejects(driver.fetcher('https://example.com/v1/chat/completions', { body: '{}' }), /only the OpenAI Chat Completions endpoint/)
  const bad = cloudToolDriver({ root, environment: env, fetchImpl: async () => new Response(JSON.stringify({ error: { message: 'Incorrect API key provided: sk-proj-abcd****wxyz' } }), { status: 401 }) })
  await assert.rejects(bad.fetcher('https://api.openai.com/v1/chat/completions', { body: '{"max_tokens":10}' }),
    error => /OpenAI tool turn failed \(401\)/.test(error.message) && !/sk-proj/.test(error.message))
})

test('a GPT-driven tool turn is not re-run by the Claude review (it would bill the whole job twice)', () => {
  const source = readFileSync(new URL('../bridge/nori-v2-query.mjs', import.meta.url), 'utf8')
  const skip = source.indexOf('if (/^\\s*\\(GPT\\) /.test(answer)) break')
  const review = source.indexOf('const reviewed = await (options.reviewTurn ?? reviewTurn)(')
  assert.ok(skip > 0 && review > skip, 'the GPT skip must come right before the review call')
})

test('fallback: a cloud failure before any text or tool runs the local loop; after a tool ran it reports instead', async () => {
  const collect = async gen => { const out = []; for await (const piece of gen) out.push(piece); return out }
  const failing = async function* () { throw new Error('cloud down') }
  const local = async function* () { yield 'local answer' }
  assert.deepEqual(await collect(withLocalFallback(failing, local)), ['local answer'])
  await assert.rejects(collect(withLocalFallback(failing, local, { toolsRan: () => true })), /cloud down/)
  const ok = async function* () { yield 'Hello'; yield ' there' }
  assert.deepEqual(await collect(withLocalFallback(ok, local)), ['(GPT) Hello', ' there'])
  const late = async function* () { yield 'part'; throw new Error('cut') }
  await assert.rejects(collect(withLocalFallback(late, local)), /cut/)
})
