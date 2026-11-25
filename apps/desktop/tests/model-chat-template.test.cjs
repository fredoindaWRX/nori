'use strict'
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto')
const { importedModelProfile } = require('../desktop/imported-model-profile.cjs')
const { gptOssLaunchPaths } = require('../desktop/gpt-oss-service.cjs')
const service = fs.readFileSync(path.join(__dirname, '../desktop/gpt-oss-service.cjs'), 'utf8')

test('the abliterated 14B pins a chat template beside the model; other profiles do not need one', () => {
  const profile = importedModelProfile('qwen3-14b')
  assert.equal(profile.variant, 'abliterated')
  assert.match(profile.chatTemplate.relativePath, /^models\/language\/huihui-qwen3-14b-abliterated-v2-[^/]+\/qwen3-chat-template\.jinja$/)
  assert.equal(path.posix.dirname(profile.chatTemplate.relativePath), path.posix.dirname(profile.relativePath))
  assert.match(profile.chatTemplate.sha256, /^[0-9a-f]{64}$/); assert.ok(profile.chatTemplate.bytes > 1000)
  for (const id of ['qwen3.5-9b', 'gpt-oss-20b']) assert.equal(importedModelProfile(id).chatTemplate, undefined, id)
})

test('the service checks the template like the projector (size, identity, hash) and passes it to the server', () => {
  assert.match(service, /safeFile\(modelRoot, profile\.chatTemplate\.relativePath, profile\.chatTemplate\.bytes,\s+profile\.chatTemplate\.bytes, inspector, resolver\)/)
  assert.match(service, /record === chatTemplate \? profile\.chatTemplate\.sha256/)
  assert.match(service, /if\(paths\.chatTemplatePath\)args\.push\('--chat-template-file',paths\.chatTemplatePath\)/)
})

test('on a PC that has the model, the real preflight accepts the pinned template and it can switch thinking off', t => {
  const profile = importedModelProfile('qwen3-14b'), file = path.join(profile.modelStoreRoot, profile.chatTemplate.relativePath)
  if (!fs.existsSync(file) || !fs.existsSync(path.join(profile.modelStoreRoot, profile.relativePath))) return t.skip('model store not on this PC')
  const text = fs.readFileSync(file)
  assert.equal(text.length, profile.chatTemplate.bytes)
  assert.equal(crypto.createHash('sha256').update(text).digest('hex'), profile.chatTemplate.sha256)
  assert.match(text.toString('utf8'), /enable_thinking is defined and enable_thinking is false/)
  assert.match(text.toString('utf8'), /<tools>/)
  const suite = 'C:/Program Files/Nori/resources/NoriSuite'
  if (!fs.existsSync(suite)) return
  assert.equal(path.normalize(gptOssLaunchPaths(suite, undefined, { modelProfile: 'qwen3-14b' }).chatTemplatePath), path.normalize(file))
  assert.equal(gptOssLaunchPaths(suite, undefined, { modelProfile: 'qwen3.5-9b' }).chatTemplatePath, null)
})
