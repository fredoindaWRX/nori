import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { askClaude, claudeDecision, claudeSetting, claudeStatusLine, costUsd, readClaudeSettings, spentToday, writeClaudeSettings } from '../bridge/claude-route.mjs'

const NOW = Date.parse('2026-11-16T12:00:00Z')
const stream = events => new Response(events.map(e => `data: ${JSON.stringify(e)}\n\n`).join(''), { status: 200 })
const reply = (text, usage = { input_tokens: 1000, output_tokens: 500 }) => stream([
  { type: 'message_start', message: { usage: { input_tokens: usage.input_tokens, output_tokens: 0 } } },
  { type: 'content_block_delta', delta: { type: 'thinking_delta', thinking: 'hidden' } },
  ...text.match(/.{1,5}/g).map(piece => ({ type: 'content_block_delta', delta: { type: 'text_delta', text: piece } })),
  { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: usage.output_tokens } },
])
async function collect(gen) { const out = []; for await (const piece of gen) out.push(piece); return out }

test('asking for Claude by name routes the turn and strips the cue, typos included', () => {
  assert.deepEqual(claudeDecision('ask claude why the sky is blue'), { question: 'why the sky is blue', why: 'asked' })
  assert.deepEqual(claudeDecision('Claude: plan my week'), { question: 'plan my week', why: 'asked' })
  assert.deepEqual(claudeDecision('use calude to explain tcp'), { question: 'explain tcp', why: 'asked' })
  assert.deepEqual(claudeDecision('what is a monad, ask claude'), { question: 'what is a monad', why: 'asked' })
  assert.equal(claudeDecision('ask claude why', { hasImages: true }), null)
  assert.equal(claudeDecision('ask claude why', { hasAttachment: true }), null)
})

test('automatic mode takes hard thinking only, and never a request about this PC', () => {
  assert.equal(claudeDecision('explain the trade-offs between rust and go for a network service')?.why, 'hard')
  assert.equal(claudeDecision('how are you doing'), null)
  assert.equal(claudeDecision('hi'), null)
  assert.equal(claudeDecision('explain why my pc is slow and check the gpu for me please now'), null)
  assert.equal(claudeDecision('turn the lights to blue and explain why you picked that colour today'), null)
  assert.equal(claudeDecision('write me a plan to review the files in this folder step by step'), null)
  assert.equal(claudeDecision('explain the trade-offs between rust and go for a network service', { auto: false }), null)
  assert.equal(claudeDecision('ask claude anything at all', { auto: false })?.why, 'asked')
})

test('spoken settings turn automatic use on and off and report status', () => {
  assert.deepEqual(claudeSetting('stop using claude'), { auto: false })
  assert.deepEqual(claudeSetting('turn off claude'), { auto: false })
  assert.deepEqual(claudeSetting('use claude for hard questions'), { auto: true })
  assert.deepEqual(claudeSetting('is claude connected'), { status: true })
  assert.equal(claudeSetting('ask claude why the sky is blue'), null)
  const root = mkdtempSync(join(tmpdir(), 'nori-claude-'))
  assert.equal(readClaudeSettings(root).auto, true)
  writeClaudeSettings(root, { auto: false })
  assert.equal(readClaudeSettings(root).auto, false)
  assert.match(claudeStatusLine(root, { ANTHROPIC_API_KEY: 'x' }, NOW), /Claude is connected\. Automatic use for hard questions is off;.*\$0\.00 of a \$2\.00 daily limit/)
  assert.match(claudeStatusLine(root, {}, NOW), /not connected/)
})

test('a turn sends only persona, recent turns and the question, streams text and records the spend', async () => {
  const root = mkdtempSync(join(tmpdir(), 'nori-claude-'))
  let sent = null
  const fetchImpl = async (url, init) => { sent = { url, headers: init.headers, body: JSON.parse(init.body) }; return reply('Because of scattering.') }
  const turns = [{ role: 'nori', text: 'orphan reply' }, { role: 'user', text: 'hello' }, { role: 'nori', text: 'hi Wil' }]
  const out = await collect(askClaude({ question: 'why is the sky blue', turns, root, environment: { ANTHROPIC_API_KEY: 'test-key' }, fetchImpl, now: NOW }))
  assert.equal(sent.url, 'https://api.anthropic.com/v1/messages')
  assert.equal(sent.headers['x-api-key'], 'test-key')
  assert.equal(sent.body.model, 'claude-opus-5-5')
  assert.equal(sent.body.stream, true)
  assert.deepEqual(sent.body.output_config, { effort: 'medium' })
  assert.equal(sent.body.thinking, undefined)
  assert.equal(sent.body.tools, undefined)
  assert.match(sent.body.system, /Be concise.*lead with the answer/)
  assert.deepEqual(sent.body.messages, [{ role: 'user', content: 'hello' }, { role: 'assistant', content: 'hi Wil' }, { role: 'user', content: 'why is the sky blue' }])
  assert.equal(out.filter(p => p.text).map(p => p.text).join(''), 'Because of scattering.')
  const done = out.at(-1)
  assert.equal(done.done, true); assert.equal(done.answer, 'Because of scattering.'); assert.equal(done.stop, 'end_turn')
  assert.equal(done.usd, costUsd('claude-opus-5-5', { input_tokens: 1000, output_tokens: 500 }))
  assert.equal(done.usd, 0.014)
  assert.equal(spentToday(root, NOW), 0.014)
  assert.doesNotMatch(readFileSync(join(root, 'learning', 'claude-usage.jsonl'), 'utf8'), /sky|test-key/)
})

test('no key, a used-up daily limit, an API error and a refusal each fail with their own code', async () => {
  const root = mkdtempSync(join(tmpdir(), 'nori-claude-'))
  const env = { ANTHROPIC_API_KEY: 'k' }
  let calls = 0
  const ok = async () => { calls++; return reply('x', { input_tokens: 400000, output_tokens: 30000 }) }
  await assert.rejects(collect(askClaude({ question: 'q', root, environment: {}, fetchImpl: ok, now: NOW })), { code: 'CLAUDE_NOT_CONFIGURED' })
  assert.equal(calls, 0)
  await collect(askClaude({ question: 'q', root, environment: env, fetchImpl: ok, now: NOW }))   // $1.60 + $0.60 = $2.20
  await assert.rejects(collect(askClaude({ question: 'q', root, environment: env, fetchImpl: ok, now: NOW })), { code: 'CLAUDE_DAILY_CAP' })
  assert.equal(calls, 1)
  assert.equal((await collect(askClaude({ question: 'q', root, environment: env, fetchImpl: ok, now: NOW + 86400000 }))).at(-1).done, true)
  const fresh = mkdtempSync(join(tmpdir(), 'nori-claude-'))
  const bad = async () => new Response(JSON.stringify({ type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } }), { status: 401 })
  await assert.rejects(collect(askClaude({ question: 'q', root: fresh, environment: env, fetchImpl: bad, now: NOW })), { code: 'CLAUDE_HTTP_401', message: 'invalid x-api-key' })
  const refused = async () => stream([{ type: 'message_start', message: { usage: { input_tokens: 10, output_tokens: 0 } } }, { type: 'message_delta', delta: { stop_reason: 'refusal' }, usage: { output_tokens: 1 } }])
  await assert.rejects(collect(askClaude({ question: 'q', root: fresh, environment: env, fetchImpl: refused, now: NOW })), { code: 'CLAUDE_REFUSED' })
})

test('a workspace id from the settings file or the environment is sent as a header, and never otherwise', async () => {
  const root = mkdtempSync(join(tmpdir(), 'nori-claude-'))
  const seen = []
  const fetchImpl = async (_url, init) => { seen.push(init.headers['anthropic-workspace-id']); return reply('ok') }
  const env = { ANTHROPIC_API_KEY: 'k' }
  await collect(askClaude({ question: 'q', root, environment: env, fetchImpl, now: NOW }))
  writeClaudeSettings(root, { workspaceId: 'wrkspc_example123' })
  assert.equal(readClaudeSettings(root).workspaceId, 'wrkspc_example123')
  await collect(askClaude({ question: 'q', root, environment: env, fetchImpl, now: NOW }))
  await collect(askClaude({ question: 'q', root, environment: { ...env, ANTHROPIC_WORKSPACE_ID: 'wrkspc_fromenv999' }, fetchImpl, now: NOW }))
  writeClaudeSettings(root, { workspaceId: 'bad id with spaces' })
  assert.equal(readClaudeSettings(root).workspaceId, undefined)
  assert.deepEqual(seen, [undefined, 'wrkspc_example123', 'wrkspc_fromenv999'])
})
