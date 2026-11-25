import test from 'node:test'
import assert from 'node:assert/strict'
import { conversationProsePolicy } from '../bridge/conversation-prose.mjs'
import { gptOssConversationPolicy } from '../bridge/local-chat.mjs'

test('plain conversation does not invent an active backend or action capability', () => {
  const policy = conversationProsePolicy({style:'Be concise.'})
  assert.doesNotMatch(policy, /Qwen3\.8|GPT-OSS 20B/)
  assert.match(policy, /current host-provided runtime facts/)
  assert.match(policy, /No action tools are available in this chat turn/)
  assert.match(policy, /Never claim actions/)
})

test('legacy Qwen no-tools policy remains honest while project route keeps its tools', t => {
  const saved=process.env.NORI_GPT_OSS_SERVER_MODEL
  t.after(()=>{if(saved===undefined)delete process.env.NORI_GPT_OSS_SERVER_MODEL;else process.env.NORI_GPT_OSS_SERVER_MODEL=saved})
  process.env.NORI_GPT_OSS_SERVER_MODEL='qwen3.8-27b'
  assert.match(gptOssConversationPolicy('balanced'), /current host-provided runtime facts/)
  const project=gptOssConversationPolicy('balanced','','','',true)
  assert.match(project, /Nori-project read tools are available/)
  assert.doesNotMatch(project, /No action tools are available in this chat turn/)
})
