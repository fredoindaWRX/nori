import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'

test('GPT-OSS durable-work denial accurately distinguishes foreground tools', async (t) => {
  const previous = {
    runtime: process.env.NORI_INFERENCE_RUNTIME,
    council: process.env.NORI_COUNCIL_URL,
  }
  process.env.NORI_INFERENCE_RUNTIME = 'gpt-oss'
  let calls = 0
  const server = createServer((_request, response) => {
    calls++
    response.statusCode = 500
    response.end('{}')
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  process.env.NORI_COUNCIL_URL = `http://127.0.0.1:${server.address().port}`
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve))
    if (previous.runtime === undefined) delete process.env.NORI_INFERENCE_RUNTIME
    else process.env.NORI_INFERENCE_RUNTIME = previous.runtime
    if (previous.council === undefined) delete process.env.NORI_COUNCIL_URL
    else process.env.NORI_COUNCIL_URL = previous.council
  })

  const { query } = await import(`../bridge/nori-v2-query.mjs?gptoss-durable-gate=${Date.now()}`)
  async function* prompt() {
    yield { message: { content: '*work analyze source files and report findings' } }
  }
  const frames = []
  for await (const frame of query({ prompt: prompt(), options: { allowWrites: true } })) frames.push(frame)

  const result = frames.at(-1)
  assert.equal(result.subtype, 'error_during_execution')
  assert.equal(result.error_code, 'NORI_GPT_OSS_CHAT_ONLY')
  assert.match(result.errors.join(' '), /persistent work queue is not qualified/i)
  assert.match(result.errors.join(' '), /separately qualified local tools may still run/i)
  assert.match(result.errors.join(' '), /no durable task was started/i)
  assert.equal(calls, 0, 'unqualified durable work must not reach the task service')
})
