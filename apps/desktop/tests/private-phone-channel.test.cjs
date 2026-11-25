const test = require('node:test')
const assert = require('node:assert/strict')
const { createServer } = require('node:http')
const { EventEmitter } = require('node:events')
const { setTimeout: delay } = require('node:timers/promises')
const { createPrivatePhoneChannel } = require('../desktop/private-phone-channel.cjs')
const { tailscaleRemoteContextAsync } = require('../desktop/tailscale-remote-context.cjs')

async function until(predicate) { const end = Date.now() + 1500; while (!predicate()) { if (Date.now() > end) throw Error('Fixture timed out'); await delay(3) } }
function listener() { const server = createServer((_, res) => res.end('synthetic')); const ready = new Promise((resolve, reject) => { server.once('listening', resolve); server.once('error', reject) }); server.listen(0, '127.0.0.1'); return { server, ready, stop: () => !server.listening ? Promise.resolve() : new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())) } }
const context = { ownerLogin: 'owner@example.test', origin: 'https://fixture.example.ts.net:8444' }

test('phone channel retries a transient identity failure without blocking desktop startup', async t => {
  let attempts = 0, created = 0; const diagnostics = []
  const owner = createPrivatePhoneChannel({ retryMs: 2, maxRetryMs: 8, getContext: async () => { if (++attempts === 1) throw Error('private detail not logged'); return context }, create: async () => { created++; return listener() }, onDiagnostic: value => diagnostics.push(value) })
  t.after(() => owner.stop()); await until(() => owner.status.ready)
  assert.equal(attempts, 2); assert.equal(created, 1)
  assert.deepEqual(diagnostics, [{ phase: 'identity', code: 'PHONE_CHANNEL_UNAVAILABLE' }])
})

test('phone channel recovers from a failed listener and an unexpected close', async t => {
  let created = 0, current
  const owner = createPrivatePhoneChannel({ retryMs: 2, maxRetryMs: 8, getContext: async () => context, create: async () => {
    if (++created === 1) throw Object.assign(Error('listener unavailable'), { code: 'EADDRINUSE' })
    current = listener(); return current
  } })
  t.after(() => owner.stop()); await until(() => owner.status.ready)
  const previous = current; await previous.stop(); await until(() => current !== previous && owner.status.ready)
  assert.equal(created, 3)
})

test('stopping pending identity lookup cannot start a listener later', async () => {
  let resolveIdentity, created = 0
  const owner = createPrivatePhoneChannel({ getContext: () => new Promise(resolve => { resolveIdentity = resolve }), create: async () => { created++; return listener() } })
  const stopping = owner.stop(); resolveIdentity(context); await stopping
  assert.equal(created, 0); assert.equal(owner.status.phase, 'stopped')
})

test('overlapping phone stop calls await the same shutdown and cancel retry timers', async () => {
  const owner = createPrivatePhoneChannel({ retryMs: 5000, maxRetryMs: 5000, getContext: async () => { throw Error('unavailable') }, create: async () => listener() })
  await until(() => owner.status.phase === 'retrying')
  const a = owner.stop(), b = owner.stop(); assert.equal(a, b); await a; assert.equal(owner.status.ready, false)
})

test('async Tailscale identity lookup preserves owner and private DNS validation', async () => {
  let options
  const result = await tailscaleRemoteContextAsync({ executable: 'fixture-tailscale', execute: async (_, args, value) => { options = value; assert.deepEqual(args, ['status', '--json']); return { stdout: JSON.stringify({ BackendState: 'Running', Self: { Online: true, UserID: 7, DNSName: 'fixture.example.ts.net.' }, User: { 7: { LoginName: 'owner@example.test' } } }) } } })
  assert.deepEqual(result, context); assert.equal(options.windowsHide, true); assert.equal(options.timeout, 4000)
  await assert.rejects(tailscaleRemoteContextAsync({ executable: 'fixture', execute: async () => ({ stdout: '{}' }) }), { code: 'TAILSCALE_IDENTITY_UNAVAILABLE' })
  let executed = false
  await assert.rejects(tailscaleRemoteContextAsync({ executable: 'fixture', port: 0, execute: async () => { executed = true } }), /Invalid Tailscale/)
  assert.equal(executed, false)
})

test('quitting during unresolved listener readiness closes the owned candidate without waiting for readiness', async () => {
  let closed = 0, rejectReady
  const diagnostics = []
  const owner = createPrivatePhoneChannel({
    getContext: async () => context,
    create: async () => ({ server: new EventEmitter(), ready: new Promise((_, reject) => { rejectReady = reject }), stop: async () => { closed++ } }),
    onDiagnostic: value => diagnostics.push(value),
  })
  await until(() => owner.status.phase === 'listen')
  await Promise.race([owner.stop(), delay(500).then(() => { throw Error('Shutdown waited on unresolved readiness') })])
  assert.equal(closed, 1)
  assert.equal(owner.status.phase, 'stopped')
  assert.deepEqual(diagnostics, [])
  // A later platform failure must stay observed after cancellation.
  rejectReady(Error('Late synthetic listener failure'))
  await delay(0)
})

test('failed listener cleanup prevents creation of a replacement listener', async () => {
  let created = 0
  const diagnostics = []
  const owner = createPrivatePhoneChannel({
    retryMs: 1, maxRetryMs: 1,
    getContext: async () => context,
    create: async () => {
      created++
      return { server: new EventEmitter(), ready: Promise.reject(Error('Synthetic bind failure')), stop: async () => { throw Error('Synthetic cleanup failure') } }
    },
    onDiagnostic: value => diagnostics.push(value),
  })
  await until(() => owner.status.phase === 'stop-failed')
  await owner.stop()
  assert.equal(created, 1)
  assert.equal(owner.status.ready, false)
  assert.equal(diagnostics.at(-1).code, 'PHONE_STOP_FAILED')
})
