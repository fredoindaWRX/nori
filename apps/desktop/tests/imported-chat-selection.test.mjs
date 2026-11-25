import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { importedChatSelection, migrateImportedChatSelection } from '../bridge/imported-chat-selection.mjs'
import { localChat, nativeModelChoices, gptOssConversationPolicy } from '../bridge/local-chat.mjs'

test('configured imported checkpoints keep their actual identity', () => {
  for (const id of ['qwen-local-9b', 'deepseek-local-14b', 'fixture-gpt-oss']) {
    const env = { NORI_GPT_OSS_SERVER_MODEL: id }
    assert.equal(importedChatSelection(env), id)
    assert.equal(migrateImportedChatSelection('nori-auto', env), id)
    assert.equal(migrateImportedChatSelection(id, env), id)
    assert.throws(() => migrateImportedChatSelection('gpt-oss:20b', env), /does not match/)
  }
})

test('known installed selections and the approved migration remain compatible', () => {
  assert.equal(importedChatSelection({}), 'gpt-oss:20b')
  const env = { NORI_GPT_OSS_SERVER_MODEL: 'qwen3.8-27b' }
  assert.equal(importedChatSelection(env), 'qwen3.8:27b')
  assert.equal(migrateImportedChatSelection('gpt-oss:20b', env), 'qwen3.8:27b')
  assert.throws(() => migrateImportedChatSelection('qwen3.8:27b', {}), /does not match/)
})

test('invalid configured model identifiers fail before selection', () => {
  for (const id of ['', 'bad model', '../checkpoint', 'x'.repeat(129), 27, null]) {
    assert.throws(() => importedChatSelection({ NORI_GPT_OSS_SERVER_MODEL: id }), /Invalid/)
  }
})

test('automatic selection reaches configured loopback inference and rejects stale choices', async t => {
  const keys = ['NORI_INFERENCE_RUNTIME', 'NORI_GPT_OSS_ENABLED', 'NORI_GPT_OSS_URL', 'NORI_GPT_OSS_SERVER_MODEL']
  const previous = Object.fromEntries(keys.map(key => [key, process.env[key]]))
  const payloads = []
  const server = createServer(async (request, response) => {
    let raw = ''
    for await (const part of request) raw += part
    payloads.push(JSON.parse(raw))
    response.writeHead(200, { 'content-type': 'text/event-stream' })
    response.end('data: {"choices":[{"delta":{"content":"Local reply."}}]}\n\ndata: [DONE]\n\n')
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(async () => {
    await new Promise(resolve => server.close(resolve))
    for (const key of keys) {
      if (previous[key] === undefined) delete process.env[key]
      else process.env[key] = previous[key]
    }
  })
  Object.assign(process.env, {
    NORI_INFERENCE_RUNTIME: 'gpt-oss', NORI_GPT_OSS_ENABLED: '1',
    NORI_GPT_OSS_URL: `http://127.0.0.1:${server.address().port}`,
    NORI_GPT_OSS_SERVER_MODEL: 'fixture-local-9b',
  })
  assert.equal(nativeModelChoices()[0].id, 'fixture-local-9b')
  const policy = gptOssConversationPolicy('balanced', '', '', '', true, false, true)
  assert.match(policy, /using fixture-local-9b as a temporary imported local checkpoint/)
  assert.match(policy, /backed by (?:the imported )?local fixture-local-9b/)
  assert.doesNotMatch(policy, /GPT-OSS 20B/)
  let answer = ''
  for await (const delta of localChat({ goal: 'Hello', turns: [], modelSelection: 'nori-auto' })) answer += delta
  assert.equal(answer, 'Local reply.')
  assert.equal(payloads[0].model, 'fixture-local-9b')
  await assert.rejects(async () => {
    for await (const delta of localChat({ goal: 'Hello', turns: [], modelSelection: 'other-local-model' })) void delta
  }, /does not match/)
  assert.equal(payloads.length, 1, 'a stale choice must fail before inference')
})
