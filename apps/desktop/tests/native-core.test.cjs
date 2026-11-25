const test = require('node:test')
const assert = require('node:assert/strict')
const { EventEmitter } = require('node:events')
const { PassThrough } = require('node:stream')
const { readFileSync,mkdtempSync,mkdirSync,symlinkSync,rmSync,writeFileSync } = require('node:fs')
const { resolve } = require('node:path')
const { ROLES, coreLaunchPaths, coreReadyRecord, coreStatePath, startNativeCore } = require('../desktop/native-core.cjs')
const { acquireStateOwner } = require('../desktop/state-owner.cjs')
const root = resolve(__dirname, '..', '..', '..')
test('Core state rejects an internal junction redirect as well as root escapes',()=>{
  const fixtureRoot=mkdtempSync(resolve(root,'verification','.nori-core-state-link-'))
  try{
    mkdirSync(resolve(fixtureRoot,'models'))
    symlinkSync(resolve(fixtureRoot,'models'),resolve(fixtureRoot,'state'),'junction')
    assert.throws(()=>coreStatePath(fixtureRoot),/Linked Core state ancestor/)
  }finally{rmSync(fixtureRoot,{recursive:true,force:true})}
})
const modelId = 'llama3.2-3b-instruct'
const runtime = { status: { modelId, maxPromptTokens: 2048 }, environment: { NORI_INFERENCE_RUNTIME: 'norllama',
  NORI_RUNTIME_MODEL_ID: modelId, NORI_RUNTIME_URL: 'http://127.0.0.1:54320', NORI_RUNTIME_API_KEY: 'r'.repeat(64) } }
test('empty Core entrypoint or configuration is refused before spawn and state creation',async()=>{
  const suite=mkdtempSync(resolve(root,'verification','.nori-empty-core-'))
  const files={
    'runtime/norllama/norllama.py':'fixture',
    'runtime/norllama/config.json':JSON.stringify({model_id:modelId,engine_binary:'engine/worker.exe',model_path:'models/model.gguf'}),
    'engine/worker.exe':'fixture','models/model.gguf':'fixture','python/Python311/python.exe':'fixture',
    'nori/main.py':'fixture','nori/config.native-suite.json':'{}',
  }
  try{
    for(const [name,text] of Object.entries(files)){const path=resolve(suite,name);mkdirSync(require('node:path').dirname(path),{recursive:true});writeFileSync(path,text)}
    for(const name of ['nori/main.py','nori/config.native-suite.json']){
      writeFileSync(resolve(suite,name),'')
      let spawned=false
      await assert.rejects(startNativeCore({root:suite,runtime,environment:{},spawnChild:()=>{spawned=true;throw Error('unexpected spawn')}}),/empty/)
      assert.equal(spawned,false)
      assert.equal(require('node:fs').existsSync(resolve(suite,'state')),false)
      writeFileSync(resolve(suite,name),files[name])
    }
  }finally{rmSync(suite,{recursive:true,force:true})}
})
const record = () => ({ runtime: 'NoriCore', backend: 'norama-independent', model_id: modelId,
  ports: Object.fromEntries(ROLES.map((role, index) => [role, 54000 + index])),
  sensors_enabled: 0, task_execution_qualified: false })

function fixture({ ready = true, exitOnEof = true, wrongHealth = false, candidate = record() } = {}) {
  const suiteRoot=mkdtempSync(resolve(root,'verification','.nori-core-suite-'))
  const files={
    'runtime/norllama/norllama.py':'test fixture only',
    'runtime/norllama/config.json':JSON.stringify({model_id:modelId,status:'TEST_FIXTURE_READY',
      engine_binary:'engine/worker.exe',model_path:'models/model.bin'}),
    'engine/worker.exe':'test fixture only',
    'models/model.bin':'test fixture only',
    'python/Python311/python.exe':'test fixture only',
    'nori/main.py':'test fixture only',
    'nori/config.native-suite.json':'{}',
  }
  for(const [name,text] of Object.entries(files)){
    const path=resolve(suiteRoot,name)
    mkdirSync(require('node:path').dirname(path),{recursive:true})
    writeFileSync(path,text)
  }
  const stateParent=resolve(suiteRoot,'state','core')
  mkdirSync(stateParent,{recursive:true})
  const dataRoot=mkdtempSync(resolve(stateParent,'.core-fixture-owner-'))
  test.after(()=>rmSync(suiteRoot,{recursive:true,force:true}))
  const child = new EventEmitter()
  child.stdin = new PassThrough()
  child.stdout = new PassThrough()
  child.exitCode = null
  child.pid = 7654321 // Not a real process.
  child.killCount = 0
  child.exit = () => { if (child.exitCode === null) { child.exitCode = 0; child.emit('exit', 0) } }
  child.kill = () => { child.killCount++; child.exit() }
  if (exitOnEof) child.stdin.once('finish', child.exit)
  const calls = [], healthCalls = []
  const spawnChild = (command, argv, options) => {
    calls.push({ command, argv, options })
    if (ready) queueMicrotask(() => child.stdout.write('Owned Core startup\n' + JSON.stringify(candidate) + '\n'))
    return child
  }
  const fetcher = async (url, options) => {
    healthCalls.push({ url, options })
    assert.equal(options.headers.Authorization, 'Bearer ' + calls[0].options.env.NORI_API_TOKEN)
    const role = ROLES[Number(new URL(url).port) - 54000]
    return new Response(JSON.stringify({ knight: wrongHealth ? 'wrong' : role,
      model_ready: true, sensory: { configured_count: 0 } }))
  }
  return { root:suiteRoot, child, calls, healthCalls, spawnChild, fetcher, dataRoot }
}

test('migration ownership refuses Core dispatch until released',async()=>{
  const f=fixture(),migration=acquireStateOwner(f.dataRoot,{purpose:'migration'})
  try{
    await assert.rejects(startNativeCore({root,runtime,...f}),/EEXIST/)
    assert.equal(f.calls.length,0)
  }finally{migration.release()}
  const core=await startNativeCore({root,runtime,...f})
  assert.throws(()=>acquireStateOwner(f.dataRoot,{purpose:'migration'}),/EEXIST/)
  await core.stop()
  const next=acquireStateOwner(f.dataRoot,{purpose:'migration'});next.release()
})

test('prepared Core state requires an explicit existing directory and never recreates it',async()=>{
  const f=fixture(),missing=resolve(f.dataRoot,'missing')
  await assert.rejects(startNativeCore({root,runtime,...f,dataRoot:missing,requirePreparedState:true}),/Prepared.*missing.*no data created/)
  assert.equal(require('node:fs').existsSync(missing),false)
  await assert.rejects(startNativeCore({root,runtime,...f,dataRoot:undefined,requirePreparedState:true}),/Prepared.*missing.*no data created/)
  assert.equal(f.calls.length,0)
  const core=await startNativeCore({root,runtime,...f,requirePreparedState:true})
  assert.equal(f.calls.length,1)
  await core.stop()
})

test('managed Core roster matches authoritative twelve native roles', () => {
  const config = JSON.parse(readFileSync(resolve(root, 'nori/config.yaml'), 'utf8'))
  assert.deepEqual([...ROLES].sort(), Object.keys(config.knights).sort())
})

test('Core record rejects wrong identity, incomplete/duplicate ports, sensors or task qualification', () => {
  assert.equal(coreReadyRecord(record(), modelId).ports.architect, 54001)
  for (const candidate of [null, { ...record(), model_id: 'other' },
    { ...record(), sensors_enabled: 1 }, { ...record(), task_execution_qualified: true },
    { ...record(), ports: { architect: 9107 } },
    { ...record(), ports: { ...record().ports, sentinel: 54001 } }]) {
    assert.throws(() => coreReadyRecord(candidate, modelId), /readiness record/)
  }
})

test('GPT-OSS Core launch path requires a contained Python runtime and exact imported identity', () => {
  const suite = mkdtempSync(resolve(root, 'verification', '.nori-imported-core-path-'))
  try {
    for (const [name, text] of Object.entries({
      'nori/main.py': 'fixture', 'python/Python311/python.exe': 'fixture',
    })) {
      const path = resolve(suite, name)
      mkdirSync(require('node:path').dirname(path), { recursive: true })
      writeFileSync(path, text)
    }
    const environment = { NORI_INFERENCE_RUNTIME: 'gpt-oss', NORI_RUNTIME_MODEL_ID: 'gpt-oss-20b',
      NORI_GPT_OSS_SERVER_MODEL: 'gpt-oss-20b', NORI_GPT_OSS_URL: 'http://127.0.0.1:18788' }
    const outside = mkdtempSync(resolve(root, 'verification', '.nori-imported-core-python-'))
    writeFileSync(resolve(outside, 'python.exe'), 'fixture')
    const paths = coreLaunchPaths(suite, environment)
    assert.equal(paths.backend, 'llama.cpp-openai-compatible-imported')
    assert.equal(paths.modelId, 'gpt-oss-20b')
    assert.equal(paths.python, resolve(suite, 'python/Python311/python.exe'))
    assert.throws(() => coreLaunchPaths(suite, { ...environment, NORI_RUNTIME_MODEL_ID: 'other' }), /matching GPT-OSS model identity/)
    assert.throws(() => coreLaunchPaths(suite, { ...environment, NORI_GPT_OSS_URL: 'https://example.com' }), /IPv4 loopback endpoint/)
    assert.throws(() => coreLaunchPaths(suite, { ...environment, NORI_RUNTIME_PYTHON: resolve(outside, 'python.exe') }), /inside Nori/)
    rmSync(outside, { recursive: true, force: true })
  } finally { rmSync(suite, { recursive: true, force: true }) }
})

test('Imported GPT-OSS Core can be owned and started without claiming tool qualification', async t => {
  const importedRecord = { ...record(), backend: 'llama.cpp-openai-compatible-imported' }
  const f = fixture({ candidate: importedRecord })
  const importedEnvironment = { NORI_INFERENCE_RUNTIME: 'gpt-oss',
    NORI_RUNTIME_MODEL_ID: modelId, NORI_GPT_OSS_SERVER_MODEL: modelId,
    NORI_GPT_OSS_URL: 'http://127.0.0.1:18788' }
  const importedRuntime = { status: { modelId }, environment: { ...importedEnvironment } }
  const core = await startNativeCore({ root: f.root, runtime: importedRuntime,
    environment: importedEnvironment, ...f })
  t.after(() => core.stop())
  assert.equal(f.calls.length, 1)
  assert.equal(f.calls[0].options.env.NORI_INFERENCE_RUNTIME, 'gpt-oss')
  assert.equal(f.calls[0].options.env.NORI_GPT_OSS_URL, importedEnvironment.NORI_GPT_OSS_URL)
  assert.equal(core.status.backend, 'llama.cpp-openai-compatible-imported')
  assert.equal(core.environment.NORI_NATIVE_CORE_READY, '1')
  assert.equal(core.environment.NORI_NATIVE_TOOLS_QUALIFIED, '0')
  assert.equal(core.status.taskExecutionQualified, false)
  assert.equal(coreReadyRecord(importedRecord, modelId, 'llama.cpp-openai-compatible-imported').backend,
    'llama.cpp-openai-compatible-imported')
  await core.stop()
})

test('Core state cannot use a different root or a model file as its ancestor', () => {
  assert.equal(coreStatePath(root), resolve(root, 'state/core'))
  assert.throws(() => coreStatePath(root, root), /inside Nori/)
  assert.throws(() => coreStatePath(root, resolve(root, '../outside')), /inside Nori/)
  assert.throws(() => coreStatePath(root, resolve(root, 'nori/main.py/child')), /ancestor/)
})

test('packaged Core source may use prepared private state in the containing Nori root', () => {
  const suiteRoot = resolve(root, 'apps/desktop/release/test-package/resources/NoriSuite')
  const privateState = resolve(root, 'state/private/core')
  assert.equal(coreStatePath(suiteRoot, privateState, root), privateState)
  assert.throws(() => coreStatePath(suiteRoot, resolve(root, '../outside'), root), /inside Nori/)
})

test('owned Core launch checks all twelve endpoints and keeps credentials outside status/argv', async () => {
  const f = fixture()
  const core = await startNativeCore({ root, runtime, ...f })
  assert.equal(f.calls.length, 1)
  assert.equal(f.healthCalls.length, 12)
  assert.equal(f.calls[0].options.shell, false)
  assert.equal(f.calls[0].options.windowsHide, true)
  assert.deepEqual(f.calls[0].argv.slice(-2), ['--supervised', '--managed-native'])
  assert.equal(core.environment.NORI_NATIVE_CORE_READY, '1')
  assert.equal(core.environment.NORI_NATIVE_TOOLS_QUALIFIED, '0')
  assert.equal(core.status.sensorsEnabled, 0)
  assert.equal(core.status.taskExecutionQualified, false)
  const key = core.environment.NORI_API_TOKEN
  assert.match(key, /^[A-Za-z0-9_-]{64}$/)
  assert.ok(!JSON.stringify(core.status).includes(key))
  assert.ok(!f.calls[0].argv.join(' ').includes(key))
  assert.notEqual(key, runtime.environment.NORI_RUNTIME_API_KEY)
  await Promise.all([core.stop(), core.stop()])
  assert.equal(f.child.exitCode, 0)
  assert.equal(f.child.killCount, 0)
})

test('managed Core receives the prompt limit reported by its owned runtime', async () => {
  const f = fixture()
  const extendedRuntime = { ...runtime, status: { ...runtime.status, maxPromptTokens: 4096 } }
  const core = await startNativeCore({ root, runtime: extendedRuntime, ...f })
  try {
    assert.equal(f.calls[0].options.env.NORI_RUNTIME_MAX_PROMPT_TOKENS, '4096')
  } finally { await core.stop() }
})

test('Core follows owned Qwen profile while preserving primary and rejecting context mismatch',async()=>{
  const model='qwen-core-fixture',f=fixture({candidate:{...record(),model_id:model}})
  const primary=resolve(f.root,'runtime/norllama/config.json'),original=readFileSync(primary,'utf8')
  const profile=resolve(f.root,'runtime/norllama/qwen-verification.json')
  writeFileSync(profile,JSON.stringify({model_id:model,architecture:'imported-qwen35',prompt_limit:65536,cache_precision:'f32',engine_binary:'engine/worker.exe',model_path:'models/model.bin'}))
  const selected={status:{modelId:model,maxPromptTokens:65536},environment:{...runtime.environment,NORI_RUNTIME_MODEL_ID:model,NORI_RUNTIME_CONFIG_PATH:profile}}
  const core=await startNativeCore({runtime:selected,...f})
  try{assert.equal(f.calls[0].options.env.NORI_RUNTIME_MAX_PROMPT_TOKENS,'65536');assert.equal(readFileSync(primary,'utf8'),original)}finally{await core.stop()}
  await assert.rejects(startNativeCore({runtime:{...selected,status:{...selected.status,maxPromptTokens:4096}},...f}),/prompt capability/)
  await assert.rejects(startNativeCore({runtime:{...selected,environment:{...selected.environment,NORI_RUNTIME_CONFIG_PATH:'relative.json'}},...f}),/absolute configuration/)
})

test('native Core drops inherited Letta settings without changing caller environments', async () => {
  const f = fixture()
  const environment = { NORI_LETTA_TOKEN_FILE: 'synthetic-token-file',
    nori_letta_api_key: 'synthetic-key', NORI_LETTA_ENDPOINT: 'http://127.0.0.1:1',
    NORI_KEEP_FIXTURE: 'retained' }
  const ownedRuntime = { ...runtime, environment: { ...runtime.environment,
    NORI_LETTA_PROTOCOL: 'synthetic-legacy' } }
  const original = { ...environment }, originalRuntime = { ...ownedRuntime.environment }
  const core = await startNativeCore({ root, runtime: ownedRuntime, environment, ...f })
  try {
    const launched = f.calls[0].options.env
    assert.deepEqual(Object.keys(launched).filter(name => name.toUpperCase().startsWith('NORI_LETTA_')), [])
    assert.equal(launched.NORI_KEEP_FIXTURE, 'retained')
    assert.equal(launched.NORI_RUNTIME_URL, runtime.environment.NORI_RUNTIME_URL)
    assert.equal(launched.NORI_DATA_ROOT, f.dataRoot)
    assert.deepEqual(environment, original)
    assert.deepEqual(ownedRuntime.environment, originalRuntime)
  } finally { await core.stop() }
})

test('Core refuses legacy runtime or external state before launching anything', async () => {
  const f = fixture()
  await assert.rejects(startNativeCore({ root, ...f, runtime: { environment: {} } }), /owned native runtime/)
  await assert.rejects(startNativeCore({ root, ...f, runtime, dataRoot: resolve(root, '../outside') }), /inside Nori/)
  assert.equal(f.calls.length, 0)
})

test('wrong Core health stops only owned Core and leaves the runtime alone', async () => {
  const f = fixture({ wrongHealth: true })
  await assert.rejects(startNativeCore({ root, runtime, ...f }), /readiness contract/)
  assert.equal(f.calls.length, 1)
  assert.equal(f.child.exitCode, 0)
  assert.equal(runtime.environment.NORI_RUNTIME_URL, 'http://127.0.0.1:54320')
})

test('Core startup timeout force-stops only its owned child if EOF fails', async () => {
  const f = fixture({ ready: false, exitOnEof: false })
  await assert.rejects(startNativeCore({ root, runtime, ...f, startupTimeout: 20, shutdownTimeout: 20 }), /deadline/)
  assert.equal(f.child.killCount, 1)
})

test('Core startup cancellation closes its parent pipe', async () => {
  const f = fixture({ ready: false })
  const abort = new AbortController()
  const pending = startNativeCore({ root, runtime, ...f, signal: abort.signal, startupTimeout: 200 })
  abort.abort()
  await assert.rejects(pending, /readiness|cancelled/)
  assert.equal(f.child.exitCode, 0)
})

test('Core parser drains later output rather than retaining logs', async () => {
  const f = fixture()
  const core = await startNativeCore({ root, runtime, ...f })
  assert.equal(f.child.stdout.listenerCount('data'), 0)
  f.child.stdout.write('x'.repeat(65536))
  await new Promise(resolveTick => setImmediate(resolveTick))
  assert.equal(f.child.stdout.readableLength, 0)
  await core.stop()
})
