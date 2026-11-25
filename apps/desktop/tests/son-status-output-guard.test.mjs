import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { nativeRuntimeChat } from '../bridge/native-runtime.mjs'
import { correctUnsupportedSonStatusClaim, needsSonStatusFactCheck } from '../bridge/son-status-output-guard.mjs'

const prompt = 'In one short sentence, explain what a temporary local model can do for Nori while her own model is being built. Do not use tools.'
const messages = [{ role: 'system', content: 'Nori system persona.' }, { role: 'user', content: prompt }]
const falseClaim = 'A temporary local model can serve as a placeholder while her own, more advanced model (Nori-20B SoN) is being trained and fine-tuned.'
const truthfulAnswer = 'The custom SoN training project has been retired. Nori uses imported local models; this conversation does not train their weights.'

test('SoN factual guard rejects active training and future-target claims after retirement', () => {
  assert.equal(needsSonStatusFactCheck(messages), true)
  assert.equal(correctUnsupportedSonStatusClaim(messages, falseClaim), truthfulAnswer)
  assert.equal(correctUnsupportedSonStatusClaim(messages, 'Nori-20B SoN is the target; training has not started and no qualified serving checkpoint exists.'), truthfulAnswer)
  assert.equal(correctUnsupportedSonStatusClaim(messages, truthfulAnswer), null)
  assert.equal(correctUnsupportedSonStatusClaim([{ role: 'user', content: 'Write a fictional scene where SoN is being trained.' }], falseClaim), null)
  assert.equal(correctUnsupportedSonStatusClaim(messages, 'The local bridge can answer ordinary questions.'), null)
})

test('native runtime withholds only a status answer until contradiction checking finishes', async () => {
  const server = createServer(async (request, response) => {
    let body = ''
    for await (const part of request) body += part
    assert.equal(request.url, '/v1/chat')
    assert.equal(JSON.parse(body).stream, true)
    response.writeHead(200, { 'content-type': 'text/event-stream', 'x-nori-request-id': '72' })
    response.end(`event: token\ndata: ${JSON.stringify({ text: falseClaim })}\n\nevent: done\ndata: [DONE]\n\n`)
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  try {
    let answer = ''
    for await (const part of nativeRuntimeChat({
      endpoint: `http://127.0.0.1:${server.address().port}`,
      apiKey: 'test-key-not-real', modelId: 'llama3.2-3b-instruct', messages,
    })) answer += part
    assert.equal(answer, truthfulAnswer)
  } finally { await new Promise(resolve => server.close(resolve)) }
})
