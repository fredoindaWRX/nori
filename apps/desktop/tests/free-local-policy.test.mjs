import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { localEndpoint, localBrain, localFetch } from '../bridge/local-policy.mjs'
import { bindNativeQuery } from '../bridge/hybrid-query.mjs'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { askOpenAI, readOpenAISettings, writeOpenAISettings } from '../bridge/openai-route.mjs'

async function collectAll(gen) { const out = []; for await (const piece of gen) out.push(piece); return out }

test('only exact loopback HTTP endpoints are accepted', () => {
  for (const host of ['localhost', '127.0.0.1', '[::1]']) {
    assert.equal(localEndpoint('test', `http://${host}:11434/`), `http://${host}:11434`)
  }
  assert.equal(localEndpoint('test', ' ', 'http://127.0.0.1:8188'), 'http://127.0.0.1:8188')
  for (const bad of ['https://api.openai.com', 'http://192.168.1.2:11434', 'http://localhost.evil.test',
    'http://user:pass@localhost', 'file:///model.gguf', 'http://localhost?token=secret', 'http://localhost/#x']) {
    assert.throws(() => localEndpoint('test', bad), /local|invalid/)
  }
})

test('cloud provider selection fails closed', () => {
  assert.equal(localBrain(undefined), 'nori-v2')
  assert.equal(localBrain('nori-v2'), 'nori-v2')
  for (const provider of ['claude', 'openai', 'groq', 'free-cloud']) {
    assert.throws(() => localBrain(provider), /disabled/)
  }
})

test('OpenAI route: off by default makes no request; only the owner switching it on lets a turn reach api.openai.com', async () => {
  const root = mkdtempSync(join(tmpdir(), 'nori-policy-openai-'))
  const urls = []
  const fetchImpl = async url => { urls.push(url); return new Response('data: {"choices":[{"delta":{"content":"hi"}}]}\n\ndata: [DONE]\n\n') }
  const run = () => collectAll(askOpenAI({ question: 'hi', root, environment: { OPENAI_API_KEY: 'test-only-key' }, fetchImpl }))
  // Free/local mode (the default): fails closed before any network call, key or no key.
  assert.equal(readOpenAISettings(root).enabled, false)
  await assert.rejects(run(), { code: 'OPENAI_OFF' })
  assert.deepEqual(urls, [])
  // Opt-in mode: exactly the official endpoint, nothing else.
  writeOpenAISettings(root, { enabled: true })
  assert.equal((await run()).at(-1).answer, 'hi')
  assert.deepEqual(urls, ['https://api.openai.com/v1/chat/completions'])
  // Switching it off again restores local-only.
  writeOpenAISettings(root, { enabled: false })
  await assert.rejects(run(), { code: 'OPENAI_OFF' })
  assert.equal(urls.length, 1)
  // The whole-brain switch stays local: OpenAI is a per-turn opt-in route, never NORI_BRAIN.
  assert.throws(() => localBrain('openai-api'), /disabled/)
})

test('image request with a legacy capability still uses native query and controls', async () => {
  let captured
  const fake = { interrupt() {}, close() {}, async *[Symbol.asyncIterator]() { yield { type: 'result' } } }
  const route = bindNativeQuery((args) => { captured = args; return fake })
  async function* prompt() { yield { message: { content: 'generate an image of a blue car' } } }
  const stream = route({ prompt: prompt(), options: { legacyToolsAvailable: true, effort: 'lightning-fast' } })
  assert.equal(stream, fake)
  assert.equal(typeof stream.interrupt, 'function')
  assert.equal(typeof stream.close, 'function')
  assert.equal(captured.options.legacyToolsAvailable, undefined)
  assert.equal(captured.options.effort, 'lightning-fast')
  assert.equal((await captured.prompt.next()).value.message.content, 'generate an image of a blue car')
})

test('remote endpoints are refused before fetch; redirects cannot forward private inputs', async () => {
  await assert.rejects(localFetch('https://api.openai.com/v1/chat/completions'), /not local/)
  let leaked = 0
  const target = createServer((_req, res) => { leaked++; res.end('unexpected') })
  const redirect = createServer((_req, res) => {
    res.writeHead(307, { location: `http://127.0.0.1:${target.address().port}/leak` }); res.end()
  })
  target.listen(0, '127.0.0.1'); await once(target, 'listening')
  redirect.listen(0, '127.0.0.1'); await once(redirect, 'listening')
  try {
    await assert.rejects(localFetch(`http://127.0.0.1:${redirect.address().port}/`, {
      method: 'POST', body: 'private prompt', redirect: 'follow',
    }))
    assert.equal(leaked, 0)
  } finally { await Promise.all([new Promise(r => target.close(r)), new Promise(r => redirect.close(r))]) }
})

test('inherited remote inference settings fail module initialization without making requests', () => {
  const cases = [['local-chat.mjs', 'NORI_OLLAMA_URL'], ['local-image.mjs', 'NORI_IMAGE_API'],
    ['local-image.mjs', 'NORI_COMFY_URL'], ['nori-v2-query.mjs', 'NORI_COUNCIL_URL']]
  for (const [file, key] of cases) {
    const result = spawnSync(process.execPath, ['--input-type=module', '-e',
      `globalThis.fetch=()=>{throw Error('NETWORK_CALLED')}; await import(${JSON.stringify(new URL(`../bridge/${file}`, import.meta.url).href)})`], {
      env: { ...process.env, [key]: 'https://paid-provider.invalid' }, encoding: 'utf8', timeout: 5000,
    })
    assert.equal(result.status, 1, file)
    assert.match(result.stderr, /free\/local mode requires/)
    assert.doesNotMatch(result.stderr, /NETWORK_CALLED/)
  }
})

test('source regression tripwires: no cloud query/speech and only cached Whisper models', () => {
  const read = p => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')
  for (const file of ['bridge/server.mjs', 'bridge/hybrid-query.mjs', 'src/lib/tts.ts']) {
    assert.doesNotMatch(read(file), /@anthropic-ai|api\.elevenlabs\.io|api\.fish\.audio|claudeQuery/)
  }
  assert.doesNotMatch(read('src/lib/voice.ts'), /new Ctor|webkitSpeechRecognition/)
  assert.match(read('src/lib/voice.ts'), /cloud speech recognition is disabled/)
  assert.match(read('src/lib/tts.ts'), /getVoices\(\)\.filter\(\(v\) => v.localService\)/)
  assert.match(read('bridge/whisper_stt.py'), /local_files_only=True/)
  assert.match(read('src/config.ts'), /export const USE_ELEVENLABS = false/)
  assert.doesNotMatch(read('src/config.ts'), /VITE_.*(?:KEY|TOKEN|MCP_URL)|https:\/\/mcp\./)
  assert.match(read('bridge/server.mjs'), /server.listen\(PORT, '127.0.0.1'\)/)
})
