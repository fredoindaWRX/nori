'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { EventEmitter } = require('node:events')
const { comfyLaunchArgs, waitForComfyStartup } = require('../desktop/comfy-startup.cjs')

test('Nori starts ComfyUI in API-only mode without its optional asset manager', () => {
  const args = comfyLaunchArgs({
    inputDirectory: 'input', outputDirectory: 'output', tempDirectory: 'temp', userDirectory: 'user', port: 18188,
  })
  assert.ok(args.includes('--disable-assets'))
  assert.ok(args.includes('--disable-all-custom-nodes'))
  assert.ok(args.includes('--lowvram'))
  assert.equal(args[args.indexOf('--port') + 1], '18188')
  assert.equal(args.includes('--cpu'), false)
})

function childProcess() {
  const child = new EventEmitter()
  child.exitCode = null
  child.signalCode = null
  child.killed = false
  child.kill = () => { child.killed = true; return true }
  return child
}

test('Comfy startup waits beyond the old 30-second deadline and returns the owned child', async () => {
  const child = childProcess()
  let checks = 0
  let elapsed = 0
  const result = await waitForComfyStartup(child, async () => ++checks === 9, {
    timeoutMs: 60_000,
    pollMs: 5_000,
    now: () => elapsed,
    sleep: async ms => { elapsed += ms },
  })
  assert.equal(result.status, 'ready')
  assert.equal(result.child, child)
  assert.equal(elapsed, 40_000)
})

test('Comfy startup detects an early child exit without waiting out its deadline', async () => {
  const child = childProcess()
  child.exitCode = 1
  let checks = 0
  const result = await waitForComfyStartup(child, async () => { checks++; return false }, {
    now: () => 0,
    sleep: async () => assert.fail('should not wait after child exit'),
  })
  assert.equal(result.status, 'failed')
  assert.equal(result.reason, 'child_exited')
  assert.equal(checks, 0)
})

test('Comfy startup stops polling at the bounded deadline', async () => {
  const child = childProcess()
  let elapsed = 0
  const result = await waitForComfyStartup(child, async () => false, {
    timeoutMs: 100,
    pollMs: 50,
    now: () => elapsed,
    sleep: async ms => { elapsed += ms },
  })
  assert.equal(result.status, 'failed')
  assert.equal(result.reason, 'readiness_timeout')
  assert.equal(elapsed, 100)
})
