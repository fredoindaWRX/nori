const test = require('node:test')
const assert = require('node:assert/strict')
const { EventEmitter } = require('node:events')
const { PassThrough } = require('node:stream')
const { resolve, dirname, relative, isAbsolute } = require('node:path')
const {mkdtempSync,mkdirSync,writeFileSync,rmSync,realpathSync}=require('node:fs')
const {tmpdir}=require('node:os')
const { nativeRuntimeMode, packagedRuntimeMode, nativeLaunchPaths, startNativeService, NATIVE_STARTUP_TIMEOUT_MS } = require('../desktop/native-service.cjs')
// Lifecycle tests use inert files and fake process handles, never installed weights.
const temporaryRoot = realpathSync(tmpdir())
const root = mkdtempSync(resolve(temporaryRoot, 'nori-native-service-tests-'))
const modelId = 'nori-launcher-fixture'
test('explicit Qwen desktop profile binds context and worker architecture',async()=>{
  const suite=mkdtempSync(resolve(temporaryRoot,'nori-native-qwen-tests-'))
  const config={model_id:modelId,engine_binary:'engine/worker.exe',model_path:'models/model.nori',architecture:'imported-qwen35',prompt_limit:65536,cache_precision:'f32'}
  try{
    for(const name of ['runtime/norllama/norllama.py','engine/worker.exe','models/model.nori','python/Python311/python.exe']){
      const path=resolve(suite,name);mkdirSync(dirname(path),{recursive:true});writeFileSync(path,'inert fixture')
    }
    const path=resolve(suite,'runtime/norllama/config.json');writeFileSync(path,JSON.stringify(config))
    assert.equal(nativeLaunchPaths(suite,{}).qwen35,true)
    const options={architecture:'imported-qwen35',startupPrompt:65536,healthPrompt:65536,startupOutput:2048,healthOutput:2048}
    const good=fixture(options),service=await startNativeService({root:suite,environment:{},...good});await service.stop()
    for(const change of [{architecture:'imported-llama'},{healthArchitecture:'imported-llama'}]){
      const bad=fixture({...options,...change});await assert.rejects(startNativeService({root:suite,environment:{},...bad}),/startup record|readiness contract/)
    }
    for(const change of [{prompt_limit:2048},{cache_precision:'f16'},{compute_backend:'cpu'}]){
      writeFileSync(path,JSON.stringify({...config,...change}));assert.throws(()=>nativeLaunchPaths(suite,{}),/Qwen|compute backend/)
    }
  }finally{rmSync(suite,{recursive:true,force:true})}
})
mkdirSync(resolve(root, 'verification'), { recursive: true })
for (const name of ['runtime/norllama/norllama.py', 'engine/worker.exe',
  'models/model.nori', 'python/Python311/python.exe']) {
  const file = resolve(root, name)
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, 'inert-fixture-not-executed')
}
writeFileSync(resolve(root, 'runtime/norllama/config.json'), JSON.stringify({
  model_id: modelId, engine_binary: 'engine/worker.exe', model_path: 'models/model.nori',
}))
test.after(() => {
  const actual = realpathSync(root)
  const delta = relative(temporaryRoot, actual)
  if (actual !== resolve(root) || isAbsolute(delta) || delta.startsWith('..') ||
      !delta.startsWith('nori-native-service-tests-')) throw Error('Unsafe test cleanup root')
  rmSync(actual, { recursive: true, force: true })
})

function fixture({ ready = true, exitOnEof = true, startupPrecision = 'f32', healthPrecision = 'f32', architecture, healthArchitecture=architecture,
  startupPrompt, healthPrompt, startupOutput, healthOutput, resourceCoordination } = {}) {
  const child = new EventEmitter()
  child.stdin = new PassThrough()
  child.stdout = new PassThrough()
  child.exitCode = null
  child.pid = 7654321 // Fixture,not a real process identity.
  child.killCount = 0
  child.exit = () => { if (child.exitCode === null) { child.exitCode = 0; child.emit('exit', 0) } }
  child.kill = () => { child.killCount++; child.exit() }
  if (exitOnEof) child.stdin.once('finish', child.exit)
  const calls = []
  const spawnChild = (command, argv, options) => {
    calls.push({ command, argv, options })
    if (ready) queueMicrotask(() => child.stdout.write(JSON.stringify({ runtime: 'NorLlama',
      backend: 'norama-independent', port: 54321, worker_pid: 7654322, cache_precision: startupPrecision,
      architecture,
      max_prompt_tokens: startupPrompt, max_output_tokens: startupOutput,
      resource_coordination: resourceCoordination }) + '\n'))
    return child
  }
  const fetcher = async (_url, options) => {
    assert.match(options.headers.Authorization, /^Bearer [A-Za-z0-9_-]{64}$/)
    return new Response(JSON.stringify({ ready: true, backend: 'norama-independent', worker_pid: 7654322, model_id: modelId, cache_precision: healthPrecision,
      architecture:healthArchitecture,qwen_matrix_cache_budget:architecture==='imported-qwen35'?13*1024**3:undefined,
      max_prompt_tokens: healthPrompt, max_output_tokens: healthOutput }))
  }
  return { child, calls, spawnChild, fetcher }
}

test('launcher defaults to own runtime and refuses external runtime selection', () => {
  assert.equal(NATIVE_STARTUP_TIMEOUT_MS, 90000)
  assert.equal(nativeRuntimeMode({}), 'norllama')
  assert.equal(nativeRuntimeMode({ NORI_INFERENCE_RUNTIME: 'gpt-oss' }), 'gpt-oss')
  for (const mode of ['ollama-rollback', 'ollama', 'llama.cpp', 'typo']) assert.throws(() => nativeRuntimeMode({ NORI_INFERENCE_RUNTIME: mode }), /no implicit fallback/)
})

test('packaged desktop defaults to GPT-OSS while source development and explicit NorLlama remain selectable',()=>{
  assert.equal(packagedRuntimeMode({packaged:true,args:[],environment:{NORI_INFERENCE_RUNTIME:'norllama'}}),'gpt-oss')
  assert.equal(packagedRuntimeMode({packaged:false,args:[],environment:{}}),'norllama')
  assert.equal(packagedRuntimeMode({packaged:true,args:['--nori-norllama'],environment:{}}),'norllama')
  assert.equal(packagedRuntimeMode({packaged:false,args:['--nori-gpt-oss'],environment:{}}),'gpt-oss')
  assert.throws(()=>packagedRuntimeMode({packaged:true,args:['--nori-gpt-oss','--nori-norllama'],environment:{}}),/one Nori local model profile/)
})

test('an empty SoN catalog refuses startup before dispatch and never borrows another backend', async () => {
  writeFileSync(resolve(root, 'runtime/norllama/mini-model-catalog.json'), JSON.stringify({ schema: 1, models: [] }))
  let spawned = false
  let scans = 0
  await assert.rejects(startNativeService({ root, environment: { NORI_MINI_AUTO_MODEL: '1' },
    scanHardware: async () => {
      scans++
      return { platform: 'win32', arch: 'x64', totalRamBytes: 32 * 1024 ** 3,
        availableRamBytes: 16 * 1024 ** 3, gpus: [] }
    },
    spawnChild: () => { spawned = true; throw Error('Unexpected model dispatch') },
  }), error => error.code === 'NORI_NO_COMPATIBLE_MODEL')
  assert.equal(scans, 1)
  assert.equal(spawned, false)
})

test('native launch preflight is rooted in Nori and refuses missing Python before dispatch', () => {
  const paths = nativeLaunchPaths(root)
  assert.equal(paths.root.toLowerCase(), root.toLowerCase())
  assert.equal(paths.modelId, modelId)
  assert.equal(paths.cachePrecision, 'f32')
  assert.equal(paths.python.toLowerCase(), resolve(root, 'python', 'Python311', 'python.exe').toLowerCase())
  assert.throws(() => nativeLaunchPaths(root, { NORI_RUNTIME_PYTHON: 'missing-python' }), /no installation/)
})

test('retired default configuration reports model unavailability before reading weight paths or dispatching', async () => {
  const configName = 'runtime/norllama/unavailable.json'
  writeFileSync(resolve(root, configName), JSON.stringify({ status: 'UNAVAILABLE',
    model_id: 'nori-son-awaiting-qualification', reason: 'private-fixture-reason',
    model_path: '../private-fixture-path', engine_binary: '../private-worker-path',
  }))
  let spawned = false
  await assert.rejects(startNativeService({ root, configName, environment: {},
    spawnChild: () => { spawned = true; throw Error('Unexpected dispatch') },
  }), error => {
    assert.equal(error.code, 'NORI_MODEL_UNAVAILABLE')
    assert.equal(error.message, 'NORI-20B SoN serving is unavailable; its checkpoint has not yet been created and qualified.')
    assert.equal(error.message.includes('private-'), false)
    return true
  })
  assert.equal(spawned, false)
})

test('unavailable primary model blocks alternate and resource profiles before dispatch',async()=>{
  const suite=mkdtempSync(resolve(root,'verification','.blocked-profile-fixture-'))
  mkdirSync(resolve(suite,'runtime/norllama'),{recursive:true})
  writeFileSync(resolve(suite,'runtime/norllama/config.json'),JSON.stringify({status:'UNAVAILABLE',model_id:'nori-20b-son-development-pending'}))
  let spawned=0,requests=0
  const barriers={spawnChild:()=>{spawned++;throw Error('must not spawn')},fetcher:()=>{requests++;throw Error('must not fetch')}}
  for(const options of [
    {configName:'runtime/norllama/old-profile.json',environment:{}},
    {environment:{NORI_RUNTIME_RESOURCE_CONFIG:'state/private/old-profile.json',NORI_RUNTIME_RESOURCE_COORDINATION:'1'}},
  ]) {
    await assert.rejects(startNativeService({root:suite,...options,...barriers}),error=>error.code==='NORI_MODEL_UNAVAILABLE')
  }
  assert.equal(spawned,0);assert.equal(requests,0)
})

test('explicit extended context needs matching startup and health; unsupported config never spawns',async()=>{
  const suite=mkdtempSync(resolve(root,'verification','.extended-launch-fixture-'))
  const configFile=resolve(suite,'runtime/norllama/config.json')
  const config={model_id:modelId,engine_binary:'engine/worker.exe',model_path:'models/model.gguf',cache_precision:'f16',prompt_limit:4096}
  try{
    for(const name of ['runtime/norllama/norllama.py','engine/worker.exe','models/model.gguf','python/Python311/python.exe']){
      const file=resolve(suite,name);mkdirSync(require('node:path').dirname(file),{recursive:true});writeFileSync(file,'fixture-not-executed')
    }
    writeFileSync(configFile,JSON.stringify(config))
    const options={startupPrecision:'f16',healthPrecision:'f16',startupPrompt:4096,healthPrompt:4096,startupOutput:2048,healthOutput:2048}
    const good=fixture(options),service=await startNativeService({root:suite,environment:{},...good})
    assert.equal(service.status.maxPromptTokens,4096);assert.equal(service.status.maxOutputTokens,2048)
    await service.stop()
    for(const change of [{startupPrompt:2048},{healthPrompt:2048},{startupOutput:4096},{healthOutput:undefined}]){
      const f=fixture({...options,...change})
      await assert.rejects(startNativeService({root:suite,environment:{},...f}),/startup record|readiness contract/)
      assert.equal(f.child.exitCode,0)
    }
    for(const change of [{cache_precision:'f32'},{prompt_limit:true},{prompt_limit:8192},{prompt_limit:'4096'}]){
      writeFileSync(configFile,JSON.stringify({...config,...change}));let spawned=false
      await assert.rejects(startNativeService({root:suite,environment:{},spawnChild:()=>{spawned=true}}),/context capability/)
      assert.equal(spawned,false)
    }
  }finally{rmSync(suite,{recursive:true,force:true})}
})

test('empty installed components fail before any process is dispatched', async () => {
  const suite=mkdtempSync(resolve(tmpdir(),'nori-empty-launch-'))
  const contents={
    'runtime/norllama/norllama.py':'fixture',
    'runtime/norllama/config.json':JSON.stringify({model_id:'fixture',engine_binary:'engine/worker.exe',model_path:'models/model.gguf'}),
    'engine/worker.exe':'fixture', 'models/model.gguf':'fixture',
    'python/Python311/python.exe':'fixture',
  }
  const put=(name,content)=>{const file=resolve(suite,name);mkdirSync(require('node:path').dirname(file),{recursive:true});writeFileSync(file,content)}
  try {
    for(const [name,content] of Object.entries(contents))put(name,content)
    for(const name of Object.keys(contents)){
      put(name,'')
      let spawned=false
      await assert.rejects(startNativeService({root:suite,environment:{},spawnChild:()=>{spawned=true;throw Error('unexpected spawn')}}),/empty|no installation/)
      assert.equal(spawned,false,name)
      put(name,contents[name])
    }
  } finally {rmSync(suite,{recursive:true,force:true})}
})

test('own native startup uses private ephemeral credentials and no shell or fixed service reuse', async () => {
  const f = fixture()
  const service = await startNativeService({ root, ...f })
  assert.equal(f.calls.length, 1)
  assert.equal(f.calls[0].options.shell, false)
  assert.equal(f.calls[0].options.windowsHide, true)
  assert.deepEqual(f.calls[0].argv.slice(-3), ['--port', '0', '--supervised'])
  assert.equal(service.environment.NORI_RUNTIME_API_KEY, f.calls[0].options.env.NORI_RUNTIME_API_KEY)
  assert.ok(!JSON.stringify(service.status).includes(service.environment.NORI_RUNTIME_API_KEY))
  assert.ok(!f.calls[0].argv.join(' ').includes(service.environment.NORI_RUNTIME_API_KEY))
  assert.equal(service.environment.NORI_INFERENCE_RUNTIME, 'norllama')
  assert.equal(service.status.modelId, modelId)
  assert.equal(service.status.cachePrecision, 'f32')
  await Promise.all([service.stop(), service.stop()])
  assert.equal(f.child.exitCode, 0)
  assert.equal(f.child.killCount, 0)
})

test('wrong native identity fails readiness and shuts down its owned process without fallback', async () => {
  const f = fixture()
  await assert.rejects(startNativeService({ root, ...f,
    fetcher: async () => new Response(JSON.stringify({ ready: true, backend: 'wrong-backend' })) }), /readiness contract/)
  assert.equal(f.calls.length, 1)
  assert.equal(f.child.exitCode, 0)
})

test('cache mode missing or mismatched in startup/health refuses and cleans up', async () => {
  for (const options of [
    { startupPrecision: null }, { startupPrecision: 'f16' },
    { healthPrecision: null }, { healthPrecision: 'f16' },
  ]) {
    const f = fixture(options)
    await assert.rejects(startNativeService({ root, ...f }), /startup record|readiness contract/)
    assert.equal(f.calls.length, 1)
    assert.equal(f.child.exitCode, 0)
  }
})

test('explicit half cache configuration requires both acknowledgements and invalid config never spawns', async () => {
  const suite = mkdtempSync(resolve(root, 'verification', '.cache-launch-fixture-'))
  const configFile = resolve(suite, 'runtime/norllama/config.json')
  const config = { model_id: modelId, engine_binary: 'engine/worker.exe', model_path: 'models/model.gguf' }
  const contents = { 'runtime/norllama/norllama.py': 'fixture', 'engine/worker.exe': 'fixture',
    'models/model.gguf': 'fixture', 'python/Python311/python.exe': 'fixture' }
  try {
    for (const [name, content] of Object.entries(contents)) {
      const file = resolve(suite, name)
      mkdirSync(require('node:path').dirname(file), { recursive: true })
      writeFileSync(file, content)
    }
    writeFileSync(configFile, JSON.stringify({ ...config, cache_precision: 'f16' }))
    const f = fixture({ startupPrecision: 'f16', healthPrecision: 'f16' })
    const service = await startNativeService({ root: suite, environment: {}, ...f })
    assert.equal(service.status.cachePrecision, 'f16')
    await service.stop()
    const wrong = fixture()
    await assert.rejects(startNativeService({ root: suite, environment: {}, ...wrong }), /startup record/)
    assert.equal(wrong.child.exitCode, 0)
    for (const value of [null, true, 16, 'half', {}, []]) {
      writeFileSync(configFile, JSON.stringify({ ...config, cache_precision: value }))
      let spawned = false
      await assert.rejects(startNativeService({ root: suite, environment: {}, spawnChild: () => { spawned = true } }), /cache precision/)
      assert.equal(spawned, false)
    }
  } finally { rmSync(suite, { recursive: true, force: true }) }
})

test('readiness parser detaches after startup and drains later output without retaining it', async () => {
  const f = fixture()
  const service = await startNativeService({ root, ...f })
  assert.equal(f.child.stdout.listenerCount('data'), 0)
  assert.equal(f.child.listenerCount('error'), 1)
  assert.equal(f.child.listenerCount('exit'), 1)
  f.child.stdout.write('x'.repeat(65536))
  await new Promise(resolveTick => setImmediate(resolveTick))
  assert.equal(f.child.stdout.readableLength, 0)
  await service.stop()
})

test('startup timeout force-stops only its exact owned child when EOF does not quiesce', async () => {
  const f = fixture({ ready: false, exitOnEof: false })
  await assert.rejects(startNativeService({ root, ...f, startupTimeout: 20, shutdownTimeout: 20 }), /deadline/)
  assert.equal(f.child.killCount, 1)
  assert.equal(f.calls.length, 1)
})

test('cancelled native startup closes the owner pipe and refuses startup success', async () => {
  const f = fixture({ ready: false })
  const controller = new AbortController()
  const pending = startNativeService({ root, ...f, signal: controller.signal, startupTimeout: 200 })
  controller.abort()
  await assert.rejects(pending, /readiness|cancelled/)
  assert.equal(f.child.exitCode, 0)
})

test('desktop resource opt-in passes owner config and requires startup acknowledgement',async()=>{
  const suite=mkdtempSync(resolve(root,'verification','.resource-desktop-fixture-'))
  const configName='state/private/runtime-resource.json'
  const config={model_id:modelId,engine_binary:'engine/worker.exe',model_path:'models/model.gguf',
    resource_coordination:{schema:1,database:'state/private/resource-budget.sqlite3',
      limits:{cpu_slots:4,ram_bytes:4096,vram_bytes:4096,pinned_ram_bytes:0},
      worker:{cpu_slots:2,ram_bytes:2048,vram_bytes:2048,pinned_ram_bytes:0},wait_seconds:2}}
  const put=(name,value)=>{const file=resolve(suite,name);mkdirSync(require('node:path').dirname(file),{recursive:true});writeFileSync(file,value)}
  try{
    for(const name of ['runtime/norllama/norllama.py','engine/worker.exe','models/model.gguf','python/Python311/python.exe'])put(name,'fixture-not-executed')
    put('runtime/norllama/config.json',JSON.stringify({model_id:modelId}))
    put(configName,JSON.stringify(config))
    const environment={NORI_RUNTIME_RESOURCE_COORDINATION:'1'}
    const f=fixture({resourceCoordination:true})
    const service=await startNativeService({root:suite,environment,configName,...f})
    assert.ok(f.calls[0].argv.includes('--resource-coordination'))
    assert.equal(f.calls[0].argv[f.calls[0].argv.indexOf('--config')+1],resolve(suite,configName))
    assert.equal(service.status.resourceCoordination,true)
    await service.stop()
    const wrong=fixture()
    await assert.rejects(startNativeService({root:suite,environment,configName,...wrong}),/startup record/)
    assert.equal(wrong.child.exitCode,0)
    const selected=fixture({resourceCoordination:true})
    const selectedService=await startNativeService({root:suite,
      environment:{...environment,NORI_RUNTIME_RESOURCE_CONFIG:configName},...selected})
    assert.equal(selectedService.status.resourceCoordination,true)
    assert.equal(selected.calls[0].argv[selected.calls[0].argv.indexOf('--config')+1],resolve(suite,configName))
    await selectedService.stop()
    for(const change of [
      {NORI_RUNTIME_RESOURCE_CONFIG:'../outside.json'},
      {NORI_RUNTIME_RESOURCE_CONFIG:'state/private/../outside.json'},
      {NORI_RUNTIME_RESOURCE_CONFIG:resolve(suite,configName)},
      {NORI_RUNTIME_RESOURCE_CONFIG:''},
      {NORI_RUNTIME_RESOURCE_CONFIG:true},
      {NORI_RUNTIME_RESOURCE_CONFIG:configName,NORI_RUNTIME_RESOURCE_COORDINATION:'0'},
      {NORI_RUNTIME_RESOURCE_CONFIG:configName,NORI_MINI_AUTO_MODEL:'1'},
    ]){
      let spawned=false,scanned=false
      await assert.rejects(startNativeService({root:suite,environment:{...environment,...change},
        scanHardware:()=>{scanned=true;throw Error('unexpected scan')},
        spawnChild:()=>{spawned=true;throw Error('unexpected spawn')}}),/Resource profile/)
      assert.equal(spawned,false);assert.equal(scanned,false)
    }
    await assert.rejects(startNativeService({root:suite,configName,
      environment:{...environment,NORI_RUNTIME_RESOURCE_CONFIG:configName}}),/Resource profile conflicts/)
    for(const env of [{},{NORI_RUNTIME_RESOURCE_COORDINATION:'0'},{NORI_RUNTIME_RESOURCE_COORDINATION:'yes'}]){
      let spawned=false
      await assert.rejects(startNativeService({root:suite,environment:env,configName,
        spawnChild:()=>{spawned=true;throw Error('unexpected spawn')}}),/coordination/)
      assert.equal(spawned,false)
    }
    for(const value of [null,{...config.resource_coordination,wait_seconds:true},
      {...config.resource_coordination,database:'../outside.sqlite3'},
      {...config.resource_coordination,extra:1}]){
      put(configName,JSON.stringify({...config,resource_coordination:value}))
      assert.throws(()=>nativeLaunchPaths(suite,environment,configName),/coordination configuration/)
    }
  }finally{rmSync(suite,{recursive:true,force:true})}
})
