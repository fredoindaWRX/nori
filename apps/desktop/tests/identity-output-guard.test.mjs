import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { nativeRuntimeChat } from '../bridge/native-runtime.mjs'
import { groundedIdentityAnswer, needsIdentityFactCheck } from '../bridge/identity-output-guard.mjs'

const identityQuestion = [{ role: 'system', content: 'Nori identity context.' }, { role: 'user', content: 'Do you know who I am?' }]
const groundedAnswer = "I don't have a confirmed name for you in this conversation. I know you're building Nori, but I won't guess who you are or invent personal details."
const noriIdentityQuestion = [
  { role: 'system', content: 'Nori identity context.' },
  { role: 'user', content: 'Nori, are you online? Reply with a short greeting and identify yourself.' },
]
const noriIdentityAnswer = "I'm online in this response through Nori's local chat runtime. I'm N.O.R.I., your one continuous local desktop intelligence. I'm your COO: you set the vision and I run operations."

test('direct identity questions receive only the identity grounded by Nori context', () => {
  assert.equal(needsIdentityFactCheck(identityQuestion), true)
  assert.equal(groundedIdentityAnswer(identityQuestion), groundedAnswer)
  assert.equal(needsIdentityFactCheck([{ role: 'user', content: 'Tell me about Nori identity design.' }]), false)
  assert.equal(groundedIdentityAnswer([{ role: 'user', content: 'What is the weather?' }]), null)
  assert.equal(groundedIdentityAnswer([{ role: 'user', content: 'What is my favorite food?' }]), null)
})

test('Nori self-identity and live local status stay grounded in the role the owner gave her', () => {
  assert.equal(needsIdentityFactCheck(noriIdentityQuestion), true)
  assert.equal(groundedIdentityAnswer(noriIdentityQuestion), noriIdentityAnswer)
  assert.equal(groundedIdentityAnswer([{ role: 'user', content: 'Who are you?' }]), "I'm N.O.R.I., your one continuous local desktop intelligence. I'm your COO: you set the vision and I run operations.")
  assert.doesNotMatch(groundedIdentityAnswer(identityQuestion), /Will|he|him/i)
  assert.equal(groundedIdentityAnswer([{ role: 'user', content: 'What is your COO strategy?' }]), null)
  assert.equal(groundedIdentityAnswer([{ role: 'user', content: 'Is the weather sunny?' }]), null)
})

test('native runtime replaces an unsupported answer on a direct identity question', async () => {
  const server = createServer(async (request, response) => {
    let body = ''
    for await (const part of request) body += part
    assert.equal(request.url, '/v1/chat')
    assert.deepEqual(JSON.parse(body).messages, identityQuestion)
    response.writeHead(200, { 'content-type': 'text/event-stream', 'x-nori-request-id': '73' })
    response.end(`event: token\ndata: ${JSON.stringify({ text: "I don't know who you are." })}\n\nevent: done\ndata: [DONE]\n\n`)
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  try {
    let answer = ''
    for await (const part of nativeRuntimeChat({
      endpoint: `http://127.0.0.1:${server.address().port}`,
      apiKey: 'test-key-not-real', modelId: 'llama3.2-3b-instruct', messages: identityQuestion,
    })) answer += part
    assert.equal(answer, groundedAnswer)
  } finally { await new Promise(resolve => server.close(resolve)) }
})

test('native runtime replaces an invented title with her real role on a Nori-self introduction', async () => {
  const server = createServer(async (request, response) => {
    let body = ''
    for await (const part of request) body += part
    assert.deepEqual(JSON.parse(body).messages, noriIdentityQuestion)
    response.writeHead(200, { 'content-type': 'text/event-stream' })
    response.end(`event: token\ndata: ${JSON.stringify({ text: 'Hello, I am Nori, the CEO.' })}\n\nevent: done\ndata: [DONE]\n\n`)
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  try {
    let answer = ''
    for await (const part of nativeRuntimeChat({
      endpoint: `http://127.0.0.1:${server.address().port}`,
      apiKey: 'test-key-not-real', modelId: 'llama3.2-3b-instruct', messages: noriIdentityQuestion,
    })) answer += part
    assert.equal(answer, noriIdentityAnswer)
    assert.doesNotMatch(answer, /CEO|chief executive officer/i)
    assert.match(answer, /I'm your COO: you set the vision and I run operations\./)
  } finally { await new Promise(resolve => server.close(resolve)) }
})
