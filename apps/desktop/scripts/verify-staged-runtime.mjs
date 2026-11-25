import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import {join,resolve} from 'node:path'
import {nativeRuntimeChat} from '../bridge/native-runtime.mjs'
const require = createRequire(import.meta.url)
const {startNativeService} = require('../desktop/native-service.cjs')
const {startNativeCore} = require('../desktop/native-core.cjs')
const root = resolve(import.meta.dirname,'../release/native-suite-payload/NoriSuite')
// Deliberately do not inherit developer Python/CUDA/runtime overrides.
const windows = process.env.SystemRoot || 'C:/Windows'
const environment = {SystemRoot:windows,WINDIR:windows,TEMP:process.env.TEMP,TMP:process.env.TMP,
  PATH:join(windows,'System32'),HF_HUB_OFFLINE:'1',TRANSFORMERS_OFFLINE:'1'}
let service
let core
let text = ''
try {
  service = await startNativeService({root,environment,startupTimeout:30000})
  const unauthorized = await fetch(service.environment.NORI_RUNTIME_URL+'/health',{signal:AbortSignal.timeout(3000),redirect:'error'})
  assert.equal(unauthorized.status,401)
  await unauthorized.body?.cancel()
  for await (const token of nativeRuntimeChat({endpoint:service.environment.NORI_RUNTIME_URL,
    apiKey:service.environment.NORI_RUNTIME_API_KEY,modelId:service.status.modelId,
    messages:[{role:'user',content:'Reply with a short greeting.'}],maxTokens:24,signal:AbortSignal.timeout(30000)})) text += token
  assert.ok(text.trim(),'Staged inference returned no text')
  core = await startNativeCore({root,runtime:service,environment,
    dataRoot:join(root,'state','staged-runtime-probe'),startupTimeout:30000})
  assert.equal(Object.keys(core.status.ports).length,12)
  assert.equal(core.status.sensorsEnabled,0)
  assert.equal(core.status.taskExecutionQualified,false)
} finally {
  if(core) await core.stop()
  if(service) await service.stop()
}
assert.equal((await service.exited).code,0)
assert.equal((await core.exited).code,0)
console.log(JSON.stringify({passed:true,root,backend:service.status.backend,modelId:service.status.modelId,
  text,unauthenticatedRefused:true,ownedRuntimeExit:0,ownedCoreExit:0,coreRoutesVerified:12,
  sensorsEnabled:0,toolsQualified:false,developerRuntimePathUsed:false,
  installedSuiteVerified:false}))
