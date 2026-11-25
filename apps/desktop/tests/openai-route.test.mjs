import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { askOpenAI, heavyTurn, openAICostUsd, openAIDecision, openAISetting, openAISpentToday, openAIStatusLine, readOpenAISettings, writeOpenAISettings } from '../bridge/openai-route.mjs'

const NOW = Date.parse('2026-11-17T12:00:00Z')
const stream = events => new Response(events.map(e => `data: ${JSON.stringify(e)}\n\n`).join('') + 'data: [DONE]\n\n', { status: 200 })
const reply = (text, usage = { prompt_tokens: 1000, completion_tokens: 500 }) => stream([
  { choices: [{ index: 0, delta: { role: 'assistant', content: '' } }] },
  ...text.match(/.{1,5}/g).map(piece => ({ choices: [{ index: 0, delta: { content: piece } }] })),
  { choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] },
  { choices: [], usage },
])
async function collect(gen) { const out = []; for await (const piece of gen) out.push(piece); return out }
const enabledRoot = () => { const root = mkdtempSync(join(tmpdir(), 'nori-openai-')); writeOpenAISettings(root, { enabled: true }); return root }

test('the OpenAI route is off by default and asks for GPT by name only', () => {
  assert.deepEqual(readOpenAISettings(mkdtempSync(join(tmpdir(), 'nori-openai-'))), { enabled: false, auto: true, tools: true, dailyUsd: 2, model: 'gpt-5-mini' })
  assert.deepEqual(openAIDecision('ask gpt why the sky is blue'), { question: 'why the sky is blue' })
  assert.deepEqual(openAIDecision('ChatGPT: plan my week'), { question: 'plan my week' })
  assert.deepEqual(openAIDecision('use openai to explain tcp'), { question: 'explain tcp' })
  assert.deepEqual(openAIDecision('what is a monad, ask gpt'), { question: 'what is a monad' })
  assert.equal(openAIDecision('explain the trade-offs between rust and go for a network service'), null)
  assert.equal(openAIDecision('ask claude why'), null)
  assert.equal(openAIDecision('ask gpt why', { hasImages: true }), null)
  assert.equal(openAIDecision('ask gpt why', { hasAttachment: true }), null)
})

test('spoken settings switch it on and off and report status', () => {
  assert.deepEqual(openAISetting('turn on openai'), { enabled: true })
  assert.deepEqual(openAISetting('enable GPT'), { enabled: true })
  assert.deepEqual(openAISetting('turn off openai'), { enabled: false })
  assert.deepEqual(openAISetting('stop using chatgpt'), { enabled: false })
  assert.deepEqual(openAISetting('openai status'), { status: true })
  assert.equal(openAISetting('ask gpt why the sky is blue'), null)
  assert.equal(openAISetting('turn off claude'), null)
  assert.deepEqual(openAISetting('use gpt for hard questions'), { enabled: true, auto: true })
  assert.deepEqual(openAISetting('only use gpt when i ask'), { auto: false })
  assert.equal(heavyTurn('design a system architecture for my shop inventory'), true)
  assert.equal(heavyTurn('explain why the sky is blue in a few sentences'), false)
  assert.equal(heavyTurn(Array(61).fill('word').join(' ')), true)
  const root = mkdtempSync(join(tmpdir(), 'nori-openai-'))
  assert.match(openAIStatusLine(root, {}, NOW), /OpenAI is off, so I stay fully local and free\. No OpenAI API key reaches me\./)
  writeOpenAISettings(root, { enabled: true })
  assert.match(openAIStatusLine(root, { OPENAI_API_KEY: 'x' }, NOW), /OpenAI is on\. An OpenAI API key reaches me\..*\$0\.00 of a \$2\.00 daily limit/)
})

test('a turn sends only persona, recent turns and the question, streams text and records the spend', async () => {
  const root = enabledRoot()
  let sent = null
  const fetchImpl = async (url, init) => { sent = { url, init, body: JSON.parse(init.body) }; return reply('Because of scattering.') }
  const turns = [{ role: 'nori', text: 'orphan reply' }, { role: 'user', text: 'hello' }, { role: 'nori', text: 'hi Wil' }]
  const out = await collect(askOpenAI({ question: 'why is the sky blue', turns, root, environment: { OPENAI_API_KEY: 'test-key' }, fetchImpl, now: NOW }))
  assert.equal(sent.url, 'https://api.openai.com/v1/chat/completions')
  assert.equal(sent.init.headers.authorization, 'Bearer test-key')
  assert.equal(sent.init.redirect, 'error')
  assert.equal(sent.body.model, 'gpt-5-mini')
  assert.equal(sent.body.stream, true)
  assert.equal(sent.body.tools, undefined)
  assert.equal(sent.body.messages[0].role, 'system')
  assert.deepEqual(sent.body.messages.slice(1), [{ role: 'user', content: 'hello' }, { role: 'assistant', content: 'hi Wil' }, { role: 'user', content: 'why is the sky blue' }])
  assert.equal(out.filter(p => p.text).map(p => p.text).join(''), 'Because of scattering.')
  const done = out.at(-1)
  assert.equal(done.done, true); assert.equal(done.answer, 'Because of scattering.'); assert.equal(done.stop, 'stop')
  assert.equal(done.usd, openAICostUsd('gpt-5-mini', { prompt_tokens: 1000, completion_tokens: 500 }))
  assert.equal(done.usd, 0.00125)
  assert.equal(openAISpentToday(root, NOW), 0.00125)
  assert.doesNotMatch(readFileSync(join(root, 'learning', 'openai-usage.jsonl'), 'utf8'), /sky|test-key/)
})

test('off, no key, a used-up daily limit, an API error and a refusal each fail with their own code', async () => {
  let calls = 0
  const ok = async () => { calls++; return reply('x', { prompt_tokens: 4_000_000, completion_tokens: 600_000 }) }
  const off = mkdtempSync(join(tmpdir(), 'nori-openai-'))
  await assert.rejects(collect(askOpenAI({ question: 'q', root: off, environment: { OPENAI_API_KEY: 'k' }, fetchImpl: ok, now: NOW })), { code: 'OPENAI_OFF' })
  await assert.rejects(collect(askOpenAI({ question: 'q', environment: { OPENAI_API_KEY: 'k' }, fetchImpl: ok, now: NOW })), { code: 'OPENAI_OFF' })
  const root = enabledRoot()
  await assert.rejects(collect(askOpenAI({ question: 'q', root, environment: {}, fetchImpl: ok, now: NOW })), { code: 'OPENAI_NOT_CONFIGURED' })
  assert.equal(calls, 0)
  const env = { OPENAI_API_KEY: 'k' }
  await collect(askOpenAI({ question: 'q', root, environment: env, fetchImpl: ok, now: NOW }))   // $1.00 + $1.20 = $2.20
  await assert.rejects(collect(askOpenAI({ question: 'q', root, environment: env, fetchImpl: ok, now: NOW })), { code: 'OPENAI_DAILY_CAP' })
  assert.equal(calls, 1)
  assert.equal((await collect(askOpenAI({ question: 'q', root, environment: env, fetchImpl: ok, now: NOW + 86400000 }))).at(-1).done, true)
  const fresh = enabledRoot()
  const bad = async () => new Response(JSON.stringify({ error: { message: 'Incorrect API key provided: sk-proj-abcd****wxyz.', code: 'invalid_api_key' } }), { status: 401 })
  await assert.rejects(collect(askOpenAI({ question: 'q', root: fresh, environment: env, fetchImpl: bad, now: NOW })),
    err => err.code === 'OPENAI_HTTP_401' && /Incorrect API key/.test(err.message) && !/sk-proj/.test(err.message))
  const refused = async () => stream([{ choices: [{ index: 0, delta: { refusal: 'no' } }] }, { choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] }])
  await assert.rejects(collect(askOpenAI({ question: 'q', root: fresh, environment: env, fetchImpl: refused, now: NOW })), { code: 'OPENAI_REFUSED' })
})
