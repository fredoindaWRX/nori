import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import {execFile} from 'node:child_process'
import {promisify} from 'node:util'
import {existsSync,writeFileSync} from 'node:fs'
const require=createRequire(import.meta.url),exec=promisify(execFile)
const {createTaskModelRouter}=require('../desktop/task-model-router.cjs')
const {startGptOssService}=require('C:/Nori/.work/model-team-integration/patch/gpt-oss-service.cjs')
const {importedModelProfile}=require('../desktop/imported-model-profile.cjs')
const report='C:/Nori/.work/reports/task-model-router-gpu-probe.json'
assert.ok(!existsSync(report),'Existing evidence preserved')
let starts=0,lastFreeMiB
const router=createTaskModelRouter({
 canLoad:async(profile,{current})=>{
  if(current?.modelId===profile)return true
  const {stdout}=await exec('nvidia-smi',['--query-gpu=memory.free','--format=csv,noheader,nounits'],{windowsHide:true,timeout:5000})
  assert.match(stdout.trim(),/^\d+$/,'Ambiguous GPU inventory')
  lastFreeMiB=Number(stdout.trim())
  const reclaimable=current?importedModelProfile(current.modelId).bytes:0
  return lastFreeMiB*1024**2+reclaimable>=importedModelProfile(profile).bytes+1024**3
 },
 startModel:async({profile,contextTokens,signal})=>{
  starts++
  return startGptOssService({root:'C:/Program Files/Nori/resources/NoriSuite',modelProfile:profile,contextTokens,signal})
 }})
const results=[]
const began=performance.now()
try{
 for(const [kind,prompt,expected] of [
  ['conversation','Reply exactly NORI_LOCAL_READY.','NORI_LOCAL_READY'],
  ['coding','Return only a Python function multiply(a, b) that returns a * b. No explanation.','a * b'],
  ['reasoning','What is 19 times 23? Reply with the integer only.','437'],
 ]){
  results.push(await router.run({kind,execute:async info=>{
   const response=await fetch(info.service.endpoint+'/v1/chat/completions',{method:'POST',headers:{'content-type':'application/json'},
    signal:AbortSignal.any([info.signal,AbortSignal.timeout(90000)]),body:JSON.stringify({model:info.modelId,
     messages:[{role:'user',content:prompt}],temperature:0,max_tokens:96,chat_template_kwargs:{enable_thinking:false}})})
   assert.equal(response.status,200)
   const result=await response.json(),reply=result.choices?.[0]?.message?.content?.trim()
   assert.ok(reply?.includes(expected),JSON.stringify({kind,reply}))
   return {kind,modelId:info.modelId,workerRoute:info.worker,reason:info.reason,contextTokens:info.contextTokens,reply,
    usage:result.usage,timings:result.timings}
  }}))
 }
}finally{await router.stop()}
const result={passed:true,scope:'source router and staged engine adapter; not the installed Nori chat or Aider pipeline',
 contextTokens:65536,full64KPromptQualified:false,results,engineStarts:starts,lastObservedFreeVramMiB:lastFreeMiB,
 elapsedSeconds:Number(((performance.now()-began)/1000).toFixed(3)),ownedEngineStopped:true,userDataChanged:false}
writeFileSync(report,JSON.stringify(result,null,2),{flag:'wx'});console.log(JSON.stringify(result))
