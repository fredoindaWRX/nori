import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { asksAboutSelf, recentProblems, selfStatus } from '../bridge/self-status.mjs'

const NOW = Date.parse('2026-11-07T15:00:00Z')
const fetcherFor = entry => async () => ({ ok: true, json: async () => ({ data: entry ? [entry] : [] }) })
const base = { memory: () => ({ entries: [] }), freeRam: () => 6 * 1024 ** 3, totalRam: () => 32 * 1024 ** 3, now: NOW, uptime: () => 600,
  gpu: async () => ({ name: 'Test GPU', totalMiB: 16376, usedMiB: 14000, freeMiB: 2376 }) }

test('health and self questions are recognized; ordinary requests are not', () => {
  for (const q of ['why are you so slow?', "what's wrong with you", 'are you ok?', 'which model are you on', 'diagnose yourself', 'what is your release', 'who are you'])
    assert.ok(asksAboutSelf(q), q)
  for (const q of ['hi', 'what is 2+2', 'write a haiku about rain', 'my laptop is slow']) assert.equal(asksAboutSelf(q), false, q)
})

test('the live model, its reason and the machine state come from measurements', async () => {
  const text = await selfStatus({ ...base, environment: {}, fetcher: fetcherFor({ backend_profile: 'qwen3-14b', context_tokens: 32768,
    routing_reason: 'preferred_capacity_unavailable', routing_since: NOW - 7 * 60000 }) })
  assert.match(text, /^\[Nori self-status: live facts about Nori, supplied by her own app\. Use these instead of guessing about yourself\.\]\n/)
  assert.match(text, /Brain right now: Huihui Qwen3 14B abliterated, .* 32K-token working context; it cannot see images/)
  assert.match(text, /Loaded because the first-choice 14B did not fit in free RAM\/VRAM when it was loaded, 7 min ago/)
  assert.match(text, /6\.0 of 32\.0 GB RAM free; Test GPU: 2\.3 of 16\.0 GB VRAM free/)
  assert.match(text, /Model order for text: Huihui Qwen3 14B abliterated .*Huihui Qwen3\.5 9B abliterated/)
  assert.match(text, /- Release: R\d+/)
})

test('an unreachable model service or GPU is reported as unknown, not guessed', async () => {
  const text = await selfStatus({ ...base, environment: {}, gpu: async () => null, fetcher: async () => { throw Error('down') } })
  assert.match(text, /did not answer, so which model is loaded is unknown/)
  assert.match(text, /GPU memory could not be read/)
})

test('recent problems come from the journal and recovered startup locks only', () => {
  const root = mkdtempSync(join(tmpdir(), 'nori-self-'))
  mkdirSync(join(root, 'learning'))
  const at = minutes => new Date(NOW - minutes * 60000).toISOString()
  writeFileSync(join(root, 'learning', 'experience.jsonl'), [
    { at: at(3000), kind: 'conversation', outcome: 'failed' }, // older than a day
    { at: at(90), kind: 'conversation', outcome: 'ok' },
    { at: at(60), kind: 'tv', outcome: 'declined' },
    { at: at(30), kind: 'conversation', outcome: 'failed' },
  ].map(entry => JSON.stringify(entry)).join('\n') + '\nnot json\n')
  writeFileSync(join(root, `.nori-state-owner.recovered-${NOW - 86_400_000}-pid1.json`), '{}')
  writeFileSync(join(root, `.nori-state-owner.recovered-${NOW - 30 * 86_400_000}-pid2.json`), '{}')
  const problems = recentProblems(root, NOW)
  assert.equal(problems.length, 2)
  assert.match(problems[0], /^2 of 3 replies in the last 24 h ended failed or declined \(tv, conversation\); the latest was 30 min ago/)
  assert.match(problems[1], /^1 stale startup lock/)
  assert.deepEqual(recentProblems(join(root, 'missing'), NOW), [])
  assert.deepEqual(recentProblems(undefined, NOW), [])
})

 test('failed HTTP is not accepted as model evidence and policy excludes the retired middle tier', async () => {
  const text = await selfStatus({ ...base, environment: {}, fetcher: async () => ({ ok:false, json:async()=>({data:[{backend_profile:'qwen3-24b-freedom',context_tokens:16384}]}) }) })
  assert.match(text, /which model is loaded is unknown/)
  assert.match(text, /at least 65,536 tokens/)
  assert.doesNotMatch(text.split('Model order for text:')[1].split('\n')[0], /24B|DavidAU/)
})
test('legacy short runtime is observed honestly without endorsing it or inventing usage', async () => {
  const text = await selfStatus({ ...base, environment:{}, fetcher:fetcherFor({backend_profile:'qwen3-24b-freedom',context_tokens:16384}) })
  assert.match(text, /16K-token working context/)
  assert.match(text, /Context mismatch/)
  assert.match(text, /not measured memory usage/)
  assert.doesNotMatch(text, /itself holds about/)
})

test('cancelled status does not read persistent memory or report completed facts', async () => {
  const controller = new AbortController()
  let memoryReads = 0
  await assert.rejects(selfStatus({ ...base, environment:{}, signal:controller.signal,
    memory:()=>{ memoryReads++; return {entries:[]} },
    fetcher:async (_url, options)=>{ assert.equal(options.redirect, 'error'); controller.abort(); return {ok:false} }
  }), {name:'AbortError'})
  assert.equal(memoryReads,0)
})
import { speedReport, selfTestLine } from '../bridge/self-status.mjs'
test('installed timing and self-test reporting remain available after policy repair', () => {
  const speed=speedReport([{outcome:'ok',outputPerSecond:20,firstTokenMs:500}],[],NOW)
  assert.match(speed,/20 tokens\/s/)
  assert.match(speed,/0.5 s/)
  const status=selfTestLine(undefined,NOW,{settings:()=>({enabled:false}),history:()=>[{at:new Date(NOW).toISOString(),pass:4,total:5,models:['fixture'],full:false}]})
  assert.match(status,/4\/5 \(80%\)/)
  assert.match(status,/turned off by the owner/)
})

test('streaming status separates owner preference from runtime state and keeps the 64K fallback', async () => {
  const text = await selfStatus({ ...base, environment: {}, streamSettings: () => ({ enabled: false }),
    fetcher: fetcherFor({ backend_profile: 'qwen3.5-9b', context_tokens: 65536,
      stream_mode: true, routing_reason: 'stream_mode_capacity_unavailable' }) })
  assert.match(text, /saved preference disabled; runtime stream mode active/)
  assert.match(text, /35B did not fit, so the 9B was loaded/)
  assert.match(text, /Preserve at least 65,536 tokens; use the 9B fallback/)
  const currentPolicy = text.split('\n').filter(line => /^- (Brain right now|Model order|Streaming):/.test(line)).join('\n')
  assert.doesNotMatch(currentPolicy, /24B|halves|faster 24/)
})

test('streaming preference cannot invent active runtime when the service is unavailable', async () => {
  const text = await selfStatus({ ...base, environment: {}, streamSettings: () => ({ enabled: true }),
    fetcher: async () => { throw Error('offline') } })
  assert.match(text, /saved preference enabled; runtime stream mode unknown/)
  const unknown = await selfStatus({ ...base, environment: {}, streamSettings: () => { throw Error('unreadable') },
    fetcher: fetcherFor({ backend_profile: 'qwen3.5-9b', context_tokens: 65536, stream_mode: false }) })
  assert.match(unknown, /saved preference unknown; runtime stream mode inactive/)
})

test('missing or malformed runtime context never becomes a verified 64K claim', async () => {
  for (const context_tokens of [undefined, null, '65536', 0, -1, 65536.5]) {
    const text = await selfStatus({ ...base, environment: {}, streamSettings: () => ({ enabled: true }),
      fetcher: fetcherFor({ backend_profile: 'qwen3.5-9b', context_tokens, routing_reason: 'stream_mode' }) })
    assert.match(text, /unknown working-context size/)
    assert.match(text, /Context verification unavailable/)
    assert.doesNotMatch(text, /NaNK|with a 64K-token working context/)
    assert.match(text, /runtime selected it for stream mode/)
  }
})

test('every ordinary turn can carry one measured line about the loaded model and its real reason', async () => {
  const { modelFact } = await import('../bridge/self-status.mjs')
  const small = await modelFact({ environment: {}, fetcher: fetcherFor({ backend_profile: 'qwen3.5-9b', context_tokens: 196608, routing_reason: 'preferred_capacity_unavailable' }) })
  assert.match(small, /^\[Nori model fact, measured by her app just now\]\n- Loaded model: .+\. Reason: the first-choice 14B did not fit in free RAM\/VRAM when it was loaded\. OBS is not running\./)
  assert.match(small, /never give a different reason/)
  const live = await modelFact({ environment: {}, fetcher: fetcherFor({ backend_profile: 'qwen3-24b-freedom', context_tokens: 32768, routing_reason: 'stream_mode', stream_mode: true }) })
  assert.match(live, /OBS is running \(stream mode active\)/)
  const unknown = await modelFact({ environment: {}, fetcher: fetcherFor({ backend_profile: 'qwen3.5-9b', context_tokens: 1 }) })
  assert.match(unknown, /reason for this choice was not reported/)
  assert.equal(await modelFact({ environment: {}, fetcher: async () => { throw new Error('down') } }), '')
})
