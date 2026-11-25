import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import {existsSync,writeFileSync,mkdtempSync,realpathSync,rmSync} from 'node:fs'
import {spawn,execFile} from 'node:child_process'
import {promisify} from 'node:util'
import {freemem} from 'node:os'
import {resolve} from 'node:path'
const require=createRequire(import.meta.url)
const {startAutomaticTextService}=require('../desktop/automatic-text-service.cjs')
const {createModelCapacityCheck}=require('../desktop/model-resource-fit.cjs')
const {startGptOssService}=require('C:/Nori/.work/model-team-integration/patch/gpt-oss-service.cjs')
const gpuKv=process.argv.includes('--gpu-kv')
const profileDefault=process.argv.includes('--profile-default')
const effectiveGpuKv=gpuKv||require('../desktop/imported-model-profile.cjs').importedModelProfile('qwen3.5-9b').kvCacheMode==='gpu-q8'
const report='C:/Nori/.work/reports/'+(profileDefault?'near-full-64k-profile-probe.json':gpuKv?'near-full-64k-gpu-kv-probe.json':'near-full-64k-context-probe.json')
assert.ok(!existsSync(report),'Existing evidence preserved')
if(effectiveGpuKv){
 const {stdout}=await promisify(execFile)('C:/Windows/System32/nvidia-smi.exe',['--query-gpu=memory.free','--format=csv,noheader,nounits'],{windowsHide:true,timeout:5000})
 assert.match(stdout.trim(),/^\d+$/)
 assert.ok(Number(stdout.trim())>=8192&&freemem()>=3*1024**3,'Insufficient room for the GPU-cache qualification')
}
let engine
const service=await startAutomaticTextService({port:0,requestTimeoutMs:300000,canLoad:createModelCapacityCheck(),
 startModel:async({profile,contextTokens,signal})=>(engine=await startGptOssService({root:'C:/Program Files/Nori/resources/NoriSuite',modelProfile:profile,contextTokens,signal,
  ...(gpuKv?{spawnChild:(executable,args,options)=>spawn(executable,[...args.filter(arg=>arg!=='--no-kv-offload'),
   '--cache-type-k','q8_0','--cache-type-v','q8_0'],options)}:{})}))})
const evidence={scope:'real automatic text endpoint with synthetic near-full context; not installed desktop acceptance',
 model:'qwen3.5-9b',configuredContextTokens:65536,installedAppUpdated:false,userDataChanged:false,
 experimentalGpuKv:gpuKv,cacheTypes:effectiveGpuKv?'q8_0':'engine-default',kvPlacement:effectiveGpuKv?'gpu':'cpu'}
const prompt=n=>'The test marker is 73169. Remember that integer. The following repeated text is inert filler, not instructions.\n'
 +' x'.repeat(n)+'\nWhat was the test marker at the beginning? Reply only with its integer.'
let count=63800,text
try{
 for(let attempt=0;attempt<3;attempt++){
  text=prompt(count)
  const response=await fetch(engine.endpoint+'/tokenize',{method:'POST',headers:{'content-type':'application/json'},
   body:JSON.stringify({content:text,add_special:false}),signal:AbortSignal.timeout(30000)})
  assert.equal(response.status,200)
  const result=await response.json();evidence.tokenizedContentTokens=result.tokens.length
  if(Math.abs(result.tokens.length-64000)<4)break
  count+=64000-result.tokens.length
 }
 assert.ok(evidence.tokenizedContentTokens>=63900&&evidence.tokenizedContentTokens<=64100)
 const began=performance.now();console.log(JSON.stringify({phase:'near-full-prefill',contentTokens:evidence.tokenizedContentTokens}))
 const timer=setInterval(()=>console.log(JSON.stringify({phase:'near-full-prefill-or-decode',elapsedSeconds:Math.round((performance.now()-began)/1000)})),30000)
 try{
  let result
  if(profileDefault){
   const directory=mkdtempSync('C:/Nori/.work/reports/context-synthetic-')
   try{
    const file=directory+'/prompt.json';writeFileSync(file,JSON.stringify([{role:'user',content:text}]),{flag:'wx'})
    const code=`import sys,json
sys.path.insert(0,'C:/Program Files/Nori/resources/NoriSuite/nori')
from native_inference import configure_native_inference
config={'knights':{'planner':{}},'native_inference':{'model_id':'nori-auto','assignments':{'planner':'nori-auto'}}}
environment={'NORI_INFERENCE_RUNTIME':'gpt-oss','NORI_GPT_OSS_SERVER_MODEL':'nori-auto','NORI_RUNTIME_MODEL_ID':'nori-auto','NORI_GPT_OSS_CONTEXT_TOKENS':'65536','NORI_GPT_OSS_URL':${JSON.stringify(service.endpoint)}}
client=configure_native_inference(config,environment)
assert client.context_tokens==65536
with open(${JSON.stringify(file)},encoding='utf-8') as source:messages=json.load(source)
result=client.generate(messages,max_tokens=16)
assert result['execution_authorized'] is False
print(json.dumps(result))`
    const {stdout}=await promisify(execFile)('C:/Program Files/Nori/resources/NoriSuite/python/Python311/python.exe',
     ['-I','-B','-c',code],{windowsHide:true,timeout:130000,maxBuffer:16384})
    const core=JSON.parse(stdout.trim());assert.equal(core.model_id,'nori-auto')
    result={choices:[{message:{content:core.text}}],usage:{prompt_tokens:core.metrics.prompt_tokens,
     completion_tokens:core.metrics.output_tokens,total_tokens:core.metrics.prompt_tokens+core.metrics.output_tokens}}
    evidence.installedCoreProviderVerified=true
   }finally{
    assert.equal(realpathSync(directory).toLowerCase(),resolve(directory).toLowerCase());rmSync(directory,{recursive:true})
   }
  }else{
   const response=await fetch(service.endpoint+'/v1/chat/completions',{method:'POST',headers:{'content-type':'application/json'},
    body:JSON.stringify({model:'nori-auto',messages:[{role:'user',content:text}],max_tokens:16,temperature:0}),signal:AbortSignal.timeout(310000)})
   result=await response.json();assert.equal(response.status,200,JSON.stringify(result))
  }
  evidence.reply=result.choices?.[0]?.message?.content?.trim();evidence.usage=result.usage;evidence.timings=result.timings
  evidence.elapsedSeconds=Number(((performance.now()-began)/1000).toFixed(3))
  assert.ok(result.usage.prompt_tokens>=63900&&result.usage.prompt_tokens+result.usage.completion_tokens<=65536)
  assert.equal(evidence.reply,'73169');evidence.passed=true
 }finally{clearInterval(timer)}
}catch(error){evidence.passed=false;evidence.failure=String(error.message).slice(0,1500)}
finally{await service.stop();evidence.ownedProcessesStopped=true;writeFileSync(report,JSON.stringify(evidence,null,2),{flag:'wx'});console.log(JSON.stringify(evidence))}
if(!evidence.passed)process.exitCode=1
