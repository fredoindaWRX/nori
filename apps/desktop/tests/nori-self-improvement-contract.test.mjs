import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { command, evolutionBrief } from '../bridge/nori-school.mjs'

test('natural self-improvement requests enter Nori’s durable improvement lane', () => {
  const result = command('no i want her to be able to improve her system by herself')
  assert.equal(result.kind, 'improve')
  assert.match(result.goal, /Autonomously improve Nori's own system/)
  assert.match(result.goal, /by herself/)
  assert.equal(command('How can Nori improve her system?'), null)
})

test('Nori owns implementation, verification, review, and eligible promotion', () => {
  const brief = evolutionBrief('improve image generation reliability')
  assert.match(brief, /Nori chooses the next useful improvement/)
  assert.match(brief, /do not stop at advice or a proposal/)
  assert.match(brief, /independent local review/)
  assert.match(brief, /may promote a reversible, in-scope application improvement herself/)
  assert.match(brief, /immediate rollback path/)
  assert.match(brief, /EVOLUTION_PROMOTED/)
  assert.match(brief, /EVOLUTION_BLOCKED/)
  assert.doesNotMatch(brief, /The owner promotes/)
})

test('canonical evolution policy requires isolated, tested, reviewed, reversible promotion', async () => {
  const policy = await readFile(join(import.meta.dirname, '..', '..', '..', 'school', 'evolution', 'NORI_EVOLUTION_POLICY.md'), 'utf8')
  assert.match(policy, /Nori may promote a reversible change/)
  assert.match(policy, /separate local reviewer/)
  assert.match(policy, /hash-verified pre-change backup/)
  assert.match(policy, /Owner checkpoints/)
  assert.match(policy, /exact\s+observed blocker/)
})

test('Nori reports the native execution qualification blocker instead of claiming self-improvement ran', async () => {
  const before = {
    runtime: process.env.NORI_INFERENCE_RUNTIME,
    core: process.env.NORI_NATIVE_CORE_READY,
  }
  process.env.NORI_INFERENCE_RUNTIME = 'norllama'
  process.env.NORI_NATIVE_CORE_READY = '1'
  try {
    const { query } = await import(`../bridge/nori-v2-query.mjs?self-improvement=${Date.now()}`)
    async function* prompt() {
      yield { message: { content: [{ type: 'text', text: 'I want you to improve your system by yourself' }] } }
    }
    const messages = []
    for await (const item of query({ prompt: prompt(), options: { allowWrites: true } })) messages.push(item)
    const result = messages.find((item) => item.type === 'result')
    assert.equal(result?.error_code, 'NORI_NATIVE_TOOLS_UNQUALIFIED')
    assert.match(result?.errors?.join(' ') ?? '', /No task was started/)
  } finally {
    if (before.runtime === undefined) delete process.env.NORI_INFERENCE_RUNTIME
    else process.env.NORI_INFERENCE_RUNTIME = before.runtime
    if (before.core === undefined) delete process.env.NORI_NATIVE_CORE_READY
    else process.env.NORI_NATIVE_CORE_READY = before.core
  }
})
