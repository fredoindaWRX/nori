import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
process.env.NORI_INFERENCE_RUNTIME = 'norllama'
process.env.NORI_LEARNING_FILE = new URL('./nonexistent-native-gate-memory.json', import.meta.url).pathname

test('native Core readiness never silently enables unqualified durable tools', async () => {
  let calls = 0
  const receiver = createServer((_request, response) => { calls++; response.end('{}') })
  await new Promise(resolveReady => receiver.listen(0, '127.0.0.1', resolveReady))
  try {
    process.env.NORI_COUNCIL_URL = `http://127.0.0.1:${receiver.address().port}`
    const { query } = await import('../bridge/nori-v2-query.mjs?native-gate')
    for (const ready of ['0', '1']) {
      process.env.NORI_NATIVE_CORE_READY = ready
      // Even a caller-provided qualification flag cannot override this gate.
      process.env.NORI_NATIVE_TOOLS_QUALIFIED = '1'
      async function* prompt() { yield { message: { content: '*work audit source files' } } }
      const results = []
      for await (const frame of query({ prompt: prompt(), options: { allowWrites: true } })) results.push(frame)
      assert.equal(results.at(-1).subtype, 'error_during_execution')
      assert.equal(results.at(-1).error_code, ready === '1' ? 'NORI_NATIVE_TOOLS_UNQUALIFIED' : 'NORI_NATIVE_CORE_UNAVAILABLE')
    }
    assert.equal(calls, 0)
  } finally { await new Promise(resolveClosed => receiver.close(resolveClosed)) }
})
