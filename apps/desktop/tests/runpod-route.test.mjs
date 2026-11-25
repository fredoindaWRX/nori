// 2026-11-22: RunPod "big brain" route. No network: every request goes to a fake fetch.
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { askRunPod, runPodDecision, runPodSetting, runPodStatusLine, readRunPodSettings, writeRunPodSettings, runPodSpentToday, runPodEndpoint } from '../bridge/runpod-route.mjs'

const root = () => mkdtempSync(join(tmpdir(), 'nori-runpod-'))
const env = { RUNPOD_API_KEY: 'rp_test_key_123456', RUNPOD_ENDPOINT_ID: 'abc123def456' }
const stream = chunks => new Response(new ReadableStream({ start(c) { for (const x of chunks) c.enqueue(new TextEncoder().encode(x)); c.close() } }), { status: 200 })
const delta = text => `data: ${JSON.stringify({ model: 'big-model', choices: [{ delta: { content: text } }] })}\n\n`
async function collect(gen) { const out = []; for await (const piece of gen) out.push(piece); return out }

test('asked by name only; settings by voice', () => {
  assert.deepEqual(runPodDecision('ask runpod to explain entropy'), { question: 'explain entropy' })
  assert.deepEqual(runPodDecision('Ask the big brain: why is the sky blue?'), { question: 'why is the sky blue?' })
  assert.deepEqual(runPodDecision('why is the sky blue, ask runpod'), { question: 'why is the sky blue' })
  assert.equal(runPodDecision('what is a run pod?'), null)
  assert.equal(runPodDecision('ask runpod about this', { hasAttachment: true }), null)
  assert.deepEqual(runPodSetting('turn on runpod'), { enabled: true })
  assert.deepEqual(runPodSetting('RunPod off'), { enabled: false })
  assert.deepEqual(runPodSetting('runpod status'), { status: true })
  assert.equal(runPodSetting('tell me about runpod pricing and whether it is worth turning on for a small studio like mine today'), null)
})

test('off by default: nothing is sent', async () => {
  const dir = root(); let calls = 0
  await assert.rejects(collect(askRunPod({ question: 'hi', root: dir, environment: env, fetchImpl: async () => { calls++; return stream([]) } })), { code: 'RUNPOD_OFF' })
  await assert.rejects(collect(askRunPod({ question: 'hi', environment: env, fetchImpl: async () => { calls++; return stream([]) } })), { code: 'RUNPOD_OFF' })
  assert.equal(calls, 0)
  assert.equal(readRunPodSettings(dir).enabled, false)
})

test('needs a key and an endpoint id; the key is never echoed', async () => {
  const dir = root(); writeRunPodSettings(dir, { enabled: true })
  await assert.rejects(collect(askRunPod({ question: 'hi', root: dir, environment: {}, fetchImpl: async () => stream([]) })), { code: 'RUNPOD_NOT_CONFIGURED' })
  await assert.rejects(collect(askRunPod({ question: 'hi', root: dir, environment: { RUNPOD_API_KEY: 'k' }, fetchImpl: async () => stream([]) })), { code: 'RUNPOD_NOT_CONFIGURED' })
  const bad = async () => new Response(JSON.stringify({ error: `bad key ${env.RUNPOD_API_KEY}` }), { status: 401 })
  await assert.rejects(collect(askRunPod({ question: 'hi', root: dir, environment: env, fetchImpl: bad })), error => error.code === 'RUNPOD_HTTP_401' && !error.message.includes(env.RUNPOD_API_KEY) && error.message.includes('[key]'))
  assert.ok(!runPodStatusLine(dir, env).includes(env.RUNPOD_API_KEY))
})

test('streams an answer to the right address, with only persona and conversation text, and counts worker time', async () => {
  const dir = root(); writeRunPodSettings(dir, { enabled: true, usdPerHour: 3.6 })
  let seen, t = 1_000_000
  const fetchImpl = async (url, init) => { seen = { url, init }; t += 20_000; return stream([delta('Hello'), delta(' Wil'), 'data: [DONE]\n\n']) }
  const out = await collect(askRunPod({ question: 'say hi', turns: [{ role: 'user', text: 'earlier' }, { role: 'assistant', text: 'reply' }], root: dir, environment: env, fetchImpl, clock: () => t }))
  assert.equal(seen.url, runPodEndpoint('abc123def456'))
  assert.equal(seen.init.headers.authorization, `Bearer ${env.RUNPOD_API_KEY}`)
  const body = JSON.parse(seen.init.body)
  assert.equal(body.stream, true); assert.equal(body.tools, undefined)
  assert.deepEqual(body.messages.slice(1).map(m => m.role), ['user', 'assistant', 'user'])
  assert.equal(body.messages.at(-1).content, 'say hi')
  assert.deepEqual(out.slice(0, 2), [{ text: 'Hello' }, { text: ' Wil' }])
  const done = out.at(-1)
  assert.equal(done.answer, 'Hello Wil'); assert.equal(done.seconds, 20); assert.ok(Math.abs(done.usd - 0.02) < 1e-9)
  assert.ok(Math.abs(runPodSpentToday(dir, t) - 0.02) < 1e-6)
  assert.ok(!readFileSync(join(dir, 'learning', 'runpod-usage.jsonl'), 'utf8').includes(env.RUNPOD_API_KEY))
})

test('daily cap stops further requests; a failed request still counts its time', async () => {
  const dir = root(); writeRunPodSettings(dir, { enabled: true, dailyUsd: 0.01, usdPerHour: 3.6 })
  let t = 5_000_000
  const failing = async () => { t += 30_000; return new Response('boom', { status: 500 }) }
  await assert.rejects(collect(askRunPod({ question: 'q', root: dir, environment: env, fetchImpl: failing, clock: () => t })), { code: 'RUNPOD_HTTP_500' })
  assert.ok(runPodSpentToday(dir, t) >= 0.03 - 1e-6)
  let calls = 0
  await assert.rejects(collect(askRunPod({ question: 'q', root: dir, environment: env, fetchImpl: async () => { calls++; return stream([]) }, clock: () => t })), { code: 'RUNPOD_DAILY_CAP' })
  assert.equal(calls, 0)
})

test('a silent endpoint times out with a plain message', async () => {
  const dir = root(); writeRunPodSettings(dir, { enabled: true })
  const hang = (_url, init) => new Promise((_resolve, reject) => init.signal.addEventListener('abort', () => reject(init.signal.reason)))
  await assert.rejects(collect(askRunPod({ question: 'q', root: dir, environment: env, fetchImpl: hang, timeoutMs: 50 })), { code: 'RUNPOD_TIMEOUT' })
})
