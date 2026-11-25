import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

test('chat turn: "ask gpt" stays local while OpenAI is off and goes through the OpenAI route once switched on', async t => {
  const root = mkdtempSync(join(tmpdir(), 'nori-openai-turn-'))
  const changes = { NORI_LEARNING_FILE: join(root, 'learning.json'), NORI_SETTINGS_DIR: root, NORI_APP_DATA_ROOT: root }
  const previous = Object.fromEntries(Object.keys(changes).map(k => [k, process.env[k]]))
  const previousFetch = globalThis.fetch
  Object.assign(process.env, changes)
  // Any real network call in this test is a failure: the local path must not need one.
  globalThis.fetch = () => { throw new Error('NETWORK_CALLED') }
  t.after(() => {
    globalThis.fetch = previousFetch
    for (const [k, v] of Object.entries(previous)) { if (v === undefined) delete process.env[k]; else process.env[k] = v }
    rmSync(root, { recursive: true, force: true })
  })
  const { query } = await import('../bridge/nori-v2-query.mjs')
  const asked = []
  async function* askOpenAI({ question }) {
    asked.push(question)
    yield { text: 'Rayleigh ' }
    yield { text: 'scattering.' }
    yield { done: true, answer: 'Rayleigh scattering.', usd: 0.001, model: 'gpt-5-mini', stop: 'stop' }
  }
  const claudeAsked = []
  async function* askClaude({ question }) {
    claudeAsked.push(question)
    yield { text: 'Deep answer.' }
    yield { done: true, answer: 'Deep answer.', usd: 0.02, model: 'claude-opus-5-5', stop: 'end_turn' }
  }
  async function run(messages) {
    async function* prompt() { for (const content of messages) yield { message: { content } } }
    const results = []
    for await (const event of query({ prompt: prompt(), options: { askOpenAI, askClaude, getModel() { assert.fail('These turns must not need local inference') } } }))
      if (event.type === 'result') results.push(event)
    return results
  }

  const off = await run(['ask gpt why is the sky blue', 'openai status'])
  assert.deepEqual(asked, [])
  assert.match(off[0].result, /OpenAI is off, so I stay local and nothing was sent/)
  assert.equal(off[0].total_cost_usd, 0)
  assert.match(off[1].result, /OpenAI is off, so I stay fully local and free/)

  const on = await run(['turn on openai', 'ask gpt why is the sky blue'])
  assert.match(on[0].result, /OpenAI is on\..*costs API money/)
  assert.deepEqual(asked, ['why is the sky blue'])
  assert.equal(on[1].subtype, 'success')
  assert.equal(on[1].result, '(GPT) Rayleigh scattering.')
  assert.equal(on[1].total_cost_usd, 0.001)

  // Automatic tiering while on: a hard question goes to GPT, the heaviest to Claude Opus.
  const hard = 'explain the trade-offs between rust and go for a network service'
  const heavy = 'design a system architecture for my small engine repair shop with inventory and billing'
  const tiers = await run([hard, heavy])
  assert.equal(tiers[0].result, '(GPT) Rayleigh scattering.')
  assert.deepEqual(asked.slice(1), [hard])
  assert.equal(tiers[1].result, '(Claude) Deep answer.')
  assert.deepEqual(claudeAsked, [heavy])
  // "use claude for hard questions" hands automatic hard turns back to Claude.
  const toClaude = await run(['use claude for hard questions', hard])
  assert.equal(toClaude[1].result, '(Claude) Deep answer.')
  assert.equal(asked.length, 2)
  await run(['use gpt for hard questions'])

  const backOff = await run(['turn off openai', 'ask gpt why is the sky blue', hard])
  assert.match(backOff[0].result, /OpenAI is off\. I stay fully local and free/)
  assert.match(backOff[1].result, /nothing was sent/)
  // Off: the hard question goes to Claude as before, never to GPT.
  assert.equal(backOff[2].result, '(Claude) Deep answer.')
  assert.equal(asked.length, 2)
})
