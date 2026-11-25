const test = require('node:test')
const assert = require('node:assert/strict')
const { startNativeStack } = require('../desktop/native-stack.cjs')

function fixture() {
  const order = []
  const component = name => {
    let exit
    const exited = new Promise(resolveExit => { exit = resolveExit })
    return { exited, exit, environment: { [name]: 'private-fixture' }, status: { [name]: true },
      stop: async () => { order.push(`stop:${name}`); exit({ code: 0 }) } }
  }
  const runtime = component('runtime'), core = component('core')
  const startRuntime = async () => { order.push('start:runtime'); return runtime }
  const startCore = async options => {
    assert.equal(options.runtime, runtime)
    assert.equal(options.dataRoot, 'fixture-state')
    order.push('start:core')
    return core
  }
  return { order, runtime, core, startRuntime, startCore, dataRoot: 'fixture-state' }
}

test('stack starts runtime before Core and stops Core before GPU service exactly once', async () => {
  const f = fixture(), startCore=f.startCore
  const stack = await startNativeStack({...f,root:'fixture-suite',stateRoot:'fixture-suite',startCore:async options=>{
    assert.equal(options.stateRoot,'fixture-suite')
    return startCore(options)
  }})
  await Promise.all([stack.stop(), stack.stop()])
  assert.deepEqual(await stack.exited, { component: 'core', code: 0, unexpected: false })
  assert.deepEqual(f.order, ['start:runtime', 'start:core', 'stop:core', 'stop:runtime'])
  assert.equal(stack.status.runtime, true)
  assert.equal(stack.status.core, true)
})

test('stack passes prepared-state requirement and separate state root to Core',async()=>{
  for(const prepared of [false,true]){
    const f=fixture(),startCore=f.startCore,stateRoot='fixture-nori-root'
    const stack=await startNativeStack({...f,root:'fixture-suite',stateRoot,requirePreparedState:prepared,startCore:async options=>{
      assert.equal(options.requirePreparedState,prepared)
      assert.equal(options.stateRoot,stateRoot)
      return startCore(options)
    }})
    await stack.stop()
  }
})

test('owner cancellation after readiness drains Core then runtime exactly once', async () => {
  const f = fixture(), controller = new AbortController()
  const stack = await startNativeStack({...f,signal:controller.signal})
  controller.abort()
  assert.equal((await stack.exited).unexpected, false)
  await stack.stop()
  assert.deepEqual(f.order,['start:runtime','start:core','stop:core','stop:runtime'])
})

test('Core startup failure cleans up owned runtime without fallback', async () => {
  const f = fixture()
  await assert.rejects(startNativeStack({ ...f, startCore: async () => { throw new Error('fixture Core failed') } }), /Core failed/)
  assert.deepEqual(f.order, ['start:runtime', 'stop:runtime'])
})
test('startup cleanup failure is explicitly propagated rather than reporting safe cancellation', async () => {
  const f = fixture()
  await assert.rejects(startNativeStack({ ...f,
    startRuntime: async () => ({ ...f.runtime, stop: async () => { throw Error('fixture cleanup failure') } }),
    startCore: async () => { throw Error('fixture startup failure') },
  }), error => error.code === 'NORI_OWNED_CLEANUP_FAILED')
})

test('runtime exit during Core startup cancels startup and releases ownership', async () => {
  const f = fixture()
  await assert.rejects(startNativeStack({ ...f, startCore: async ({ signal }) => {
    f.runtime.exit({ code: 1 })
    await new Promise(resolveTick => setImmediate(resolveTick))
    assert.equal(signal.aborted, true)
    throw new Error('fixture runtime lost')
  } }), /runtime lost/)
  assert.deepEqual(f.order, ['start:runtime', 'stop:runtime'])
})

test('unexpected Core exit closes its owned runtime and reports the failed component', async () => {
  const f = fixture()
  const stack = await startNativeStack(f)
  f.core.exit({ code: 1 })
  assert.deepEqual(await stack.exited, { component: 'core', code: 1, unexpected: true })
  assert.deepEqual(f.order, ['start:runtime', 'start:core', 'stop:core', 'stop:runtime'])
})

test('unexpected runtime exit closes Core before reporting stack death', async () => {
  const f = fixture()
  const stack = await startNativeStack(f)
  f.runtime.exit({ code: 1 })
  assert.deepEqual(await stack.exited, { component: 'runtime', code: 1, unexpected: true })
  assert.deepEqual(f.order, ['start:runtime', 'start:core', 'stop:core', 'stop:runtime'])
})

test('late owner stop cannot relabel an unexpected exit while sibling cleanup is pending', async () => {
  const f = fixture()
  let releaseCleanup, cleanupEntered
  const entered = new Promise(resolve => { cleanupEntered = resolve })
  const gate = new Promise(resolve => { releaseCleanup = resolve })
  const originalStop = f.core.stop
  f.core.stop = async () => { cleanupEntered(); await gate; await originalStop() }
  const stack = await startNativeStack(f)
  f.runtime.exit({ code: 1 })
  await entered
  const lateStop = stack.stop()
  releaseCleanup()
  await lateStop
  assert.deepEqual(await stack.exited, { component: 'runtime', code: 1, unexpected: true })
  assert.deepEqual(f.order, ['start:runtime', 'start:core', 'stop:core', 'stop:runtime'])
})

test('unexpected exit retains failed cleanup evidence and still attempts runtime stop', async () => {
  const f = fixture()
  f.core.stop = async () => { f.order.push('stop:core'); throw Error('fixture cleanup failure') }
  const stack = await startNativeStack(f)
  f.core.exit({ code: 1 })
  assert.deepEqual(await stack.exited, { component: 'core', code: 1, unexpected: true, cleanupFailed: true })
  await assert.rejects(stack.stop(), /fixture cleanup failure/)
  assert.deepEqual(f.order, ['start:runtime', 'start:core', 'stop:core', 'stop:runtime'])
})

test('an exit recorded on the original child before same-turn quit stays unexpected', async () => {
  for (const code of [0, 1]) {
    const f = fixture()
    f.core.child = { exitCode: null, signalCode: null }
    const stack = await startNativeStack(f)
    f.core.child.exitCode = code
    f.core.exit({ code })
    await stack.stop()
    assert.deepEqual(await stack.exited, { component: 'core', code, unexpected: true })
  }
})

test('a signal recorded on the original child before quit stays unexpected', async () => {
  const f = fixture()
  f.runtime.child = { exitCode: null, signalCode: 'SIGTERM' }
  const stack = await startNativeStack(f)
  f.runtime.exit({ code: null, signal: 'SIGTERM' })
  await stack.stop()
  assert.deepEqual(await stack.exited, { component: 'runtime', code: null, signal: 'SIGTERM', unexpected: true })
})
