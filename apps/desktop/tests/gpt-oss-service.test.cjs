const test = require('node:test')
const assert = require('node:assert/strict')
const { EventEmitter } = require('node:events')
const { lstatSync, mkdirSync, writeFileSync, rmSync, realpathSync } = require('node:fs')
const { createHash } = require('node:crypto')
const { tmpdir } = require('node:os')
const { dirname, resolve, relative, isAbsolute, join } = require('node:path')
const { PORT, STARTUP_TIMEOUT_MS, GPU_LAYERS, MODEL_RELATIVE, SERVER_RELATIVE, HERETIC_ADAPTER_RELATIVE, RUNTIME_FILES, gptOssLaunchPaths, startGptOssService, resolveGptOssContextTokens } = require('../desktop/gpt-oss-service.cjs')
const { importedModelProfile } = require('../desktop/imported-model-profile.cjs')
const { startGptOssService: wiredService } = require('../desktop/native-service.cjs')

const root = realpathSync(require('node:fs').mkdtempSync(join(tmpdir(), 'nori-gpt-oss-service-')))
const modelPath = resolve(root, MODEL_RELATIVE)
const serverPath = resolve(root, SERVER_RELATIVE)
const runtimePaths = RUNTIME_FILES.map(([name]) => resolve(root, name))
const adapterPath = resolve(root, HERETIC_ADAPTER_RELATIVE)
const adapterBytes = Buffer.concat([Buffer.from('nori-inert-heretic-adapter-test-fixture'), Buffer.alloc(64 * 1024)])
const adapterSha256 = createHash('sha256').update(adapterBytes).digest('hex')
for (const [path, content] of [[modelPath, 'inert-model-fixture'], [serverPath, 'inert-executable-fixture'],
  ...runtimePaths.map(path => [path, 'inert-runtime-library-fixture'])]) {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, content)
}
mkdirSync(dirname(adapterPath), { recursive: true })
writeFileSync(adapterPath, adapterBytes)
test.after(() => {
  const actual = realpathSync(root)
  const delta = relative(tmpdir(), actual)
  if (isAbsolute(delta) || delta.startsWith('..') || !delta.startsWith('nori-gpt-oss-service-'))
    throw Error('Unsafe GPT-OSS test cleanup root')
  rmSync(actual, { recursive: true, force: true })
})

function qualifiedInspect(path) {
  const stat = lstatSync(path)
  return { ...stat, size: path.toLowerCase() === modelPath.toLowerCase() ? 12 * 1024 ** 3 : 4 * 1024 ** 2,
    nlink: 1, isFile: () => stat.isFile(), isDirectory: () => stat.isDirectory(), isSymbolicLink: () => stat.isSymbolicLink() }
}
const openedPaths = new Map()
const inspect = {
  inspector: qualifiedInspect,
  opener(path, flags) {
    const fd = require('node:fs').openSync(path, flags)
    openedPaths.set(fd, path)
    return fd
  },
  fstat(fd) {
    return qualifiedInspect(openedPaths.get(fd))
  },
}

test('GPT-OSS accepts an independently installed physical NoriSuite root',()=>{
  const paths=gptOssLaunchPaths(root,inspect)
  assert.equal(paths.root,root)
  assert.equal(paths.modelPath,modelPath)
})

test('CUDA BLAS libraries and redistribution notice must be inventoried and present before launch',async()=>{
  for(const name of ['cublas64_13.dll','cublasLt64_13.dll','NVIDIA-CUDA-EULA.txt']) {
    const required=`engine/gpt-oss-runtime/build/bin/${name}`
    assert.ok(RUNTIME_FILES.some(([path])=>path===required),`${name} must reach packaging and preflight`)
    let spawned=false
    await assert.rejects(startGptOssService({root,inspect:{...inspect,inspector(path){
      if(path.toLowerCase()===resolve(root,required).toLowerCase())throw Object.assign(new Error('Missing portable CUDA component'),{code:'ENOENT'})
      return qualifiedInspect(path)
    }},spawnChild(){spawned=true},checkPort:async()=>assert.fail('missing files must fail before port checks')}),/Missing portable CUDA component/)
    assert.equal(spawned,false)
  }
})

test('native packaging inventory includes the CUDA runtime closure and notice',async()=>{
  const {nativeGptOssFiles}=await import('../scripts/native-payload-plan.mjs')
  for(const name of ['cublas64_13.dll','cublasLt64_13.dll','NVIDIA-CUDA-EULA.txt'])
    assert.ok(nativeGptOssFiles.includes(`engine/gpt-oss-runtime/build/bin/${name}`),`${name} must be packaged`)
})

test('native-service exposes GPT-OSS as explicit optional service without changing NorLlama default', () => {
  assert.equal(wiredService, startGptOssService)
})

test('GPT-OSS cold start allows up to 90 seconds for model readiness', () => {
  assert.equal(STARTUP_TIMEOUT_MS, 90_000)
})

test('GPT-OSS GPU offload leaves capacity for Nori desktop rendering', () => {
  assert.equal(GPU_LAYERS, 8)
})

test('imported service admits explicit 64K context and rejects unsupported sizes', async () => {
  const child = new EventEmitter()
  child.exitCode = null
  child.signalCode = null
  child.pid = 987653
  child.kill = signal => { child.signalCode = signal; child.emit('exit', null, signal) }
  let spawnRecord
  const service = await startGptOssService({ root, inspect, contextTokens: 65536,
    spawnChild: (command, args) => { spawnRecord = { command, args }; return child },
    checkPort: async () => {}, fetcher: async () => new Response('', { status: 200 }) })
  assert.equal(spawnRecord.args[spawnRecord.args.indexOf('--ctx-size') + 1], '65536')
  assert.equal(service.contextTokens, 65536)
  await service.stop()
  await assert.rejects(startGptOssService({ root, inspect, contextTokens: 16384,
    spawnChild: () => { throw new Error('must not launch unsupported context') } }), /Unsupported GPT-OSS context profile/)
})

test('long-context routing profile admits the measured 196K window', () => {
  assert.equal(importedModelProfile('qwen3.6-35b').defaultContext, 65536)
  assert.equal(importedModelProfile('qwen3.5-9b').defaultContext, 196608)
  assert.equal(resolveGptOssContextTokens(196608), 196608)
})

test('Codex provider is opt-in, follows the Nori model lifecycle, and stops before the model', async () => {
  const child = new EventEmitter()
  child.exitCode = null
  child.signalCode = null
  child.pid = 987652
  const shutdownOrder = []
  child.kill = signal => { shutdownOrder.push('model'); child.signalCode = signal; child.emit('exit', null, signal) }
  const service = await startGptOssService({ root, inspect, contextTokens: 8192, localAgentProvider: true,
    startAgentProvider: async (...args) => {
      assert.deepEqual(args, [{modelId:'gpt-oss-20b'}])
      return { endpoint: 'http://127.0.0.1:1234/v1', port: 1234,
        stop: async () => shutdownOrder.push('relay') }
    }, spawnChild: () => child, checkPort: async () => {},
    fetcher: async () => new Response('', { status: 200 }) })
  assert.deepEqual(service.localAgentProvider, { endpoint: 'http://127.0.0.1:1234/v1', port: 1234 })
  assert.equal(service.status.localAgentProvider, true)
  await service.stop()
  assert.deepEqual(shutdownOrder, ['relay', 'model'])
})

test('Codex provider bind failure stops the owned model instead of silently retrying or falling back', async () => {
  const child = new EventEmitter()
  child.exitCode = null
  child.signalCode = null
  child.pid = 987651
  child.kill = signal => { child.signalCode = signal; child.emit('exit', null, signal) }
  await assert.rejects(startGptOssService({ root, inspect, localAgentProvider: true,
    startAgentProvider: async () => { throw new Error('local port is already occupied') },
    spawnChild: () => child, checkPort: async () => {},
    fetcher: async () => new Response('', { status: 200 }) }), /local port is already occupied/)
  assert.equal(child.signalCode, 'SIGTERM')
})

test('Codex local provider rejects alternate Heretic weights before model launch', async () => {
  let spawned = false
  await assert.rejects(startGptOssService({ root, inspect, localAgentProvider: true,
    hereticAdapter: true, spawnChild: () => { spawned = true } }), /only the pinned base GPT-OSS model/)
  assert.equal(spawned, false)
})

test('GPT-OSS launch is pinned to the Nori model/runtime paths and constrained to loopback', async () => {
  const paths = gptOssLaunchPaths(root, inspect)
  assert.equal(paths.modelPath, modelPath)
  assert.equal(paths.executablePath, serverPath)
  assert.equal(paths.modelSizeBytes, 12 * 1024 ** 3)
  assert.deepEqual(paths.runtimeFiles, runtimePaths)
  const child = new EventEmitter()
  child.exitCode = null
  child.signalCode = null
  child.pid = 987654
  child.kill = signal => { child.signalCode = signal; child.emit('exit', null, signal) }
  let spawnRecord
  const service = await startGptOssService({ root, inspect, spawnChild: (command, args, options) => {
    spawnRecord = { command, args, options }
    return child
  }, checkPort: async port => assert.equal(port, PORT), fetcher: async url => {
    assert.equal(url, `http://127.0.0.1:${PORT}/health`)
    return new Response('', { status: 200 })
  } })
  assert.equal(spawnRecord.command, serverPath)
  assert.equal(spawnRecord.options.shell, false)
  assert.equal(spawnRecord.options.windowsHide, true)
  assert.equal(spawnRecord.args[spawnRecord.args.indexOf('--host') + 1], '127.0.0.1')
  assert.equal(spawnRecord.args[spawnRecord.args.indexOf('--port') + 1], String(PORT))
  assert.ok(spawnRecord.args.includes('--jinja'))
  assert.equal(spawnRecord.args[spawnRecord.args.indexOf('--ctx-size') + 1], '78000')
  assert.equal(spawnRecord.args[spawnRecord.args.indexOf('--n-gpu-layers') + 1], '8')
  assert.equal(service.status.trainedByNori, false)
  assert.equal(service.status.sonCheckpoint, false)
  await service.stop()
  assert.equal(child.signalCode, 'SIGTERM')
})

test('Heretic candidate is opt-in, pinned by digest, and added only as a LoRA adapter', async () => {
  const paths = gptOssLaunchPaths(root, inspect, { hereticAdapter: true, expectedAdapterSha256: adapterSha256 })
  assert.equal(paths.adapterPath, adapterPath)
  const child = new EventEmitter()
  child.exitCode = null
  child.signalCode = null
  child.pid = 987655
  child.kill = signal => { child.signalCode = signal; child.emit('exit', null, signal) }
  let spawnRecord
  const service = await startGptOssService({ root, inspect, hereticAdapter: true,
    expectedAdapterSha256: adapterSha256, spawnChild: (command, args, options) => {
      spawnRecord = { command, args, options }
      return child
    }, checkPort: async () => {}, fetcher: async () => new Response('', { status: 200 }) })
  assert.equal(spawnRecord.args[spawnRecord.args.indexOf('--alias') + 1], 'nori-heretic-candidate')
  assert.equal(spawnRecord.args[spawnRecord.args.indexOf('--parallel') + 1], '1')
  assert.equal(spawnRecord.args[spawnRecord.args.indexOf('--lora') + 1], adapterPath)
  assert.equal(service.status.hereticAdapter, true)
  assert.equal(service.status.hereticQualified, false)
  assert.equal(service.status.trainedByNori, false)
  await service.stop()
})

test('Heretic adapter hash mismatch is rejected before process dispatch', async () => {
  let spawned = false
  assert.throws(() => gptOssLaunchPaths(root, inspect, { hereticAdapter: true,
    expectedAdapterSha256: '0'.repeat(64) }), /digest does not match/)
  await assert.rejects(startGptOssService({ root, inspect, hereticAdapter: true,
    expectedAdapterSha256: '0'.repeat(64), spawnChild: () => { spawned = true } }), /digest does not match/)
  assert.equal(spawned, false)
})

test('missing GPT-OSS model fails closed without spawning a child', async t => {
  const absentRoot = realpathSync(require('node:fs').mkdtempSync(join(tmpdir(), 'nori-gpt-oss-absent-')))
  t.after(() => {
    const delta = relative(tmpdir(), realpathSync(absentRoot))
    assert.ok(!isAbsolute(delta) && !delta.startsWith('..') && delta.startsWith('nori-gpt-oss-absent-'), 'Unsafe absent fixture cleanup')
    rmSync(absentRoot, { recursive: true, force: true })
  })
  let spawned = false
  await assert.rejects(startGptOssService({ root: absentRoot, inspect: { allowTestRoot: true },
    spawnChild: () => { spawned = true } }), /ENOENT/)
  assert.equal(spawned, false)
})

test('GPT-OSS spawn failure reports the process error without waiting for nonexistent child cleanup', async () => {
  const child = new EventEmitter()
  child.exitCode = null
  child.signalCode = null
  let killCalls = 0
  child.kill = () => { killCalls++; return false }
  const startedAt = Date.now()
  await assert.rejects(startGptOssService({ root, inspect, startupTimeout: 1000,
    spawnChild: () => {
      queueMicrotask(() => child.emit('error', Object.assign(new Error('spawn denied'), { code: 'EACCES' })))
      return child
    }, checkPort: async () => {}, fetcher: async () => { throw Error('not reached') } }),
  error => error.code === 'NORI_GPT_OSS_SPAWN_FAILED' && /EACCES/.test(error.message))
  assert.equal(killCalls, 0)
  assert.ok(Date.now() - startedAt < 500, 'Spawn failure should not wait through shutdown timeouts')
})

test('wrong model size is rejected before any process dispatch', () => {
  assert.throws(() => gptOssLaunchPaths(root, { ...inspect, inspector(path) {
    const stat = qualifiedInspect(path)
    if (path.toLowerCase() === modelPath.toLowerCase()) return { ...stat, size: 1, isFile: () => true }
    return stat
  } }), /identity or size/)
})
