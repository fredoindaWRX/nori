import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import {execFile} from 'node:child_process'
import {promisify} from 'node:util'
import {existsSync,writeFileSync} from 'node:fs'
const require=createRequire(import.meta.url),exec=promisify(execFile)
const {startAutomaticTextService}=require('../desktop/automatic-text-service.cjs')
const {createModelCapacityCheck}=require('../desktop/model-resource-fit.cjs')
const {startGptOssService}=require('C:/Nori/.work/model-team-integration/patch/gpt-oss-service.cjs')
const root='C:/Program Files/Nori/resources/NoriSuite'
const report=process.argv[2]||'C:/Nori/.work/reports/automatic-text-live-probe.json'
assert.match(report,/^C:\/Nori\/\.work\/reports\/automatic-text-live-probe(?:-r\d+)?\.json$/)
assert.ok(!existsSync(report),'Existing evidence preserved')
const service=await startAutomaticTextService({port:0,canLoad:createModelCapacityCheck(),
 startModel:({profile,contextTokens,signal})=>startGptOssService({root,modelProfile:profile,contextTokens,signal})})
const evidence={scope:'source automatic endpoint with installed Native Core provider; no desktop or approved Aider task execution',
 contextTokens:65536,full64KPromptQualified:false,installedAppUpdated:false,tests:[]}
try{
 const models=await(await fetch(service.endpoint+'/v1/models')).json();assert.equal(models.data[0].id,'nori-auto')
 const response=await fetch(service.endpoint+'/v1/chat/completions',{method:'POST',headers:{'content-type':'application/json'},
  body:JSON.stringify({model:'nori-auto',messages:[{role:'user',content:'Think deeply about this: what is 19 times 23? Reply only with the integer.'}],
   max_tokens:64,temperature:0,chat_template_kwargs:{enable_thinking:false}}),signal:AbortSignal.timeout(90000)})
 assert.equal(response.status,200)
 const value=await response.json();assert.equal(value.model,'nori-auto');assert.equal(value.choices[0].message.content.trim(),'437')
 evidence.tests.push({name:'automatic model request',passed:true,model:value.model,physicalProfile:response.headers.get('x-nori-backend-profile'),
  reason:response.headers.get('x-nori-routing-reason'),reply:value.choices[0].message.content,timings:value.timings})
 const python=`import sys,json
sys.path.insert(0,${JSON.stringify(root+'/nori')})
from native_inference import configure_native_inference
cfg={'knights':{'planner':{},'reviewer':{}},'native_inference':{'model_id':'nori-auto','assignments':{'planner':'nori-auto','reviewer':'nori-auto'}}}
env={'NORI_INFERENCE_RUNTIME':'gpt-oss','NORI_GPT_OSS_SERVER_MODEL':'nori-auto','NORI_RUNTIME_MODEL_ID':'nori-auto','NORI_GPT_OSS_CONTEXT_TOKENS':'65536','NORI_GPT_OSS_URL':${JSON.stringify(service.endpoint)}}
client=configure_native_inference(cfg,env)
assert client.context_tokens==65536
result=client.generate([{'role':'user','content':'Reply exactly NORI_CORE_LINK_OK.'}],max_tokens=128)
assert result['text'].strip()=='NORI_CORE_LINK_OK',result
assert result['execution_authorized'] is False
print(json.dumps({'passed':True,'model':result['model_id'],'reply':result['text'],'executionAuthorized':False}))`
 const {stdout}=await exec(root+'/python/Python311/python.exe',['-I','-B','-c',python],{windowsHide:true,timeout:120000,maxBuffer:16384})
 evidence.tests.push({name:'installed Core provider automatic-model connection',...JSON.parse(stdout.trim())})
 evidence.passed=true
}catch(error){evidence.passed=false;evidence.failure=String(error.message).slice(0,2000);throw error}
finally{await service.stop();evidence.ownedProcessesStopped=true;writeFileSync(report,JSON.stringify(evidence,null,2),{flag:'wx'});console.log(JSON.stringify(evidence))}
