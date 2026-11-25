// Actual desktop lifecycle/streaming acceptance in an isolated layout under Nori.
import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
import {createReadStream, existsSync, mkdirSync, copyFileSync, linkSync, readFileSync, writeFileSync} from 'node:fs'
import {join, resolve} from 'node:path'
import {createRequire} from 'node:module'
import {spawnSync} from 'node:child_process'
import {nativeRuntimeChat} from '../bridge/native-runtime.mjs'
const {startNativeService}=createRequire(import.meta.url)('../desktop/native-service.cjs')
const root=resolve(import.meta.dirname,'../../..')
const layout=join(root,'verification/context-lifecycle-layout-20261006')
const output=join(root,'verification/nori-extended-context-desktop-lifecycle-20261006.json')
assert.ok(!existsSync(layout)&&!existsSync(output),'Existing evidence/layout preserved')
const hash=async file=>{const d=createHash('sha256');for await(const b of createReadStream(file))d.update(b);return d.digest('hex')}
const proofPath=join(root,'verification/nori-extended-context-http-gpu-20261006.json')
const proof=JSON.parse(readFileSync(proofPath,'utf8'))
assert.equal(proof.passed,true);assert.equal(proof.worker_exit_zero,true)
for(const [name,value] of Object.entries(proof.source_hashes))assert.equal(await hash(join(root,name)),value.toLowerCase(),name)
const powershell=join(process.env.SystemRoot,'System32/WindowsPowerShell/v1.0/powershell.exe')
const preflight=spawnSync(powershell,['-NoProfile','-Command',"@(Get-CimInstance Win32_Process | Where-Object { $_.Name -match '^(norama-worker|extended-context-worker|Nori)\\.exe$' }).Count"],{encoding:'utf8',timeout:15000,windowsHide:true})
assert.equal(preflight.status,0);assert.equal(preflight.stdout.trim(),'0','Do not compete with another owner/worker')
const configOriginal=await hash(join(root,'runtime/norllama/config.json'))
const runtimeFiles=['norllama.py','owned_process.py','installation_paths.py','contract_grammar.py']
mkdirSync(join(layout,'runtime/norllama'),{recursive:true})
mkdirSync(join(layout,'engine/norama'),{recursive:true})
mkdirSync(join(layout,'models'),{recursive:true})
for(const file of runtimeFiles)copyFileSync(join(root,'runtime/norllama',file),join(layout,'runtime/norllama',file))
// Read-only inference shares existing disk bytes; never duplicate or write model weights.
linkSync(join(root,'engine/norama/tests/builds/extended-context-config-20261006/extended-context-worker.exe'),join(layout,'engine/norama/candidate.exe'))
linkSync(join(root,'models/language/llama3.2-3b-instruct/llama3.2-3b-instruct.gguf'),join(layout,'models/candidate.gguf'))
writeFileSync(join(layout,'runtime/norllama/config.json'),JSON.stringify({port:11435,engine_binary:'engine/norama/candidate.exe',model_path:'models/candidate.gguf',model_id:'candidate-3b',cache_precision:'f16',prompt_limit:4096}),{flag:'wx'})
const report={schema:'nori.extended-context-desktop-lifecycle.v1',passed:false,previousProofSha256:await hash(proofPath),
  sourceHashes:{},productionConfigChanged:false,releaseVerified:false,
  limits:['Actual source desktop lifecycle, bundled Python, separate supervised runtime and real GPU streaming.',
    'Isolated test layout under Nori, not production configuration or installed GUI/package.',
    'Imported 3B weights; no full Core/Knights, 12B or quality qualification.']}
for(const name of ['apps/desktop/desktop/native-service.cjs','apps/desktop/bridge/native-runtime.mjs','apps/desktop/bridge/local-policy.mjs','apps/desktop/scripts/probe-extended-context-launcher.mjs'])report.sourceHashes[name]=await hash(join(root,name))
let service
try{
  service=await startNativeService({root:layout,environment:{...process.env,NORI_RUNTIME_PYTHON:join(root,'python/Python311/python.exe')}})
  assert.equal(service.status.maxPromptTokens,4096);assert.equal(service.status.cachePrecision,'f16')
  report.status=service.status
  let reply=''
  for await(const text of nativeRuntimeChat({endpoint:service.environment.NORI_RUNTIME_URL,apiKey:service.environment.NORI_RUNTIME_API_KEY,
    modelId:service.status.modelId,messages:[{role:'user',content:'hello '.repeat(2200)+'\nReply with one short greeting.'}],maxTokens:4,signal:AbortSignal.timeout(120000)}))reply+=text
  assert.ok(reply);report.reply=reply
  await service.stop();report.runtimeExit=await service.exited
  assert.equal(report.runtimeExit.code,0)
  const absent=spawnSync(powershell,['-NoProfile','-Command',`if(Get-CimInstance Win32_Process -Filter "ProcessId=${service.status.workerPid}"){exit 1}else{exit 0}`],{encoding:'utf8',timeout:15000,windowsHide:true})
  assert.equal(absent.status,0);report.ownedWorkerAbsent=true
  assert.equal(await hash(join(root,'runtime/norllama/config.json')),configOriginal)
  for(const [name,value] of Object.entries(proof.source_hashes))assert.equal(await hash(join(root,name)),value.toLowerCase(),name)
  for(const file of runtimeFiles)assert.equal(await hash(join(layout,'runtime/norllama',file)),await hash(join(root,'runtime/norllama',file)))
  for(const [name,value] of Object.entries(report.sourceHashes))assert.equal(await hash(join(root,name)),value,name)
  report.inputsUnchanged=true;report.passed=true
}catch(error){report.failure={type:error.name,message:error.message};throw error}
finally{if(service)await service.stop();writeFileSync(output,JSON.stringify(report,null,2),{flag:'wx'})}
console.log(JSON.stringify({passed:report.passed,reply:report.reply,workerPid:report.status.workerPid,ownedWorkerAbsent:true}))
