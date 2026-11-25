const test = require('node:test')
const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const { resolve } = require('node:path')
const { runInNewContext } = require('node:vm')
const { nativeModelStatus } = require('../desktop/native-model-status.cjs')

function manager(runtime = 'norllama') {
  const source = readFileSync(resolve(__dirname, '../desktop/main.cjs'), 'utf8')
  const start = source.indexOf('function configureModelManager() {')
  const end = source.indexOf("app.setName('N.O.R.I.')", start)
  assert.ok(start >= 0 && end > start)
  const handlers = new Map()
  const frame = {}
  const webContents = { mainFrame: frame }
  const blocked = () => { throw Error('Unexpected network or process action') }
  runInNewContext(source.slice(start, end) + '\nconfigureModelManager()', {
    window: { webContents }, ipcMain: { handle: (channel, callback) => handlers.set(channel, callback) },
    nativeService: runtime === 'gpt-oss' ? null : { runtime: { child: { exitCode: null } }, core: { child: { exitCode: null } },
      status: { modelId: 'nori-test-fixture' } },
    gptOssService: runtime === 'gpt-oss' ? { modelId: 'gpt-oss-20b', child: { exitCode: null, signalCode: null } } : null,
    nativeModelStatus, RUNTIME_MODE: runtime,
    RUNTIME_MODE: runtime, fetch: blocked, spawn: blocked, consumeModelProgress: blocked,
    appIdentity: blocked,
  })
  return { handlers, owner: { sender: webContents, senderFrame: frame }, webContents }
}

test('legacy model install and removal calls are refused without network or process actions', async () => {
  for (const runtime of ['norllama', 'ollama-rollback']) {
    const { handlers, owner } = manager(runtime)
    for (const channel of ['nori:models:install-deep', 'nori:models:remove-deep']) {
      const result = await handlers.get(channel)(owner)
      assert.equal(result.ok, false)
      assert.match(result.error, /SoN model activation is pending/)
    }
  }
})

test('model controls reject another renderer or frame before exposing status', async () => {
  const { handlers, webContents } = manager()
  for (const event of [{ sender: {}, senderFrame: webContents.mainFrame },
    { sender: webContents, senderFrame: {} }]) {
    for (const channel of ['nori:models:install-deep', 'nori:models:remove-deep']) {
      const result = await handlers.get(channel)(event)
      assert.equal(result.ok, false)
      assert.match(result.error, /did not come from Nori/)
    }
    const status = await handlers.get('nori:models:status')(event)
    assert.equal(status.online, false)
    assert.equal(status.loadedModel, undefined)
  }
})

test('status reports the actual owned runtime model without a GPT-OSS placeholder', async () => {
  const { handlers, owner } = manager()
  const status = await handlers.get('nori:models:status')(owner)
  assert.equal(status.loadedModel, 'nori-test-fixture')
  assert.equal(status.model, 'nori-test-fixture')
  assert.equal(status.online, true)
  assert.equal(status.installed, false)
})

test('GPT-OSS desktop status flows through IPC with imported-model qualification', async () => {
  const { handlers, owner } = manager('gpt-oss')
  const status = await handlers.get('nori:models:status')(owner)
  assert.equal(status.online, true)
  assert.equal(status.loadedModel, 'gpt-oss-20b')
  assert.equal(status.trainedByNori, false)
  assert.equal(status.sonCheckpoint, false)
  assert.equal(status.toolsQualified, false)
})
