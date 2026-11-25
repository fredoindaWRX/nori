import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import {existsSync,writeFileSync} from 'node:fs'
const require=createRequire(import.meta.url)
const {startGptOssService}=require('C:/Nori/.work/model-team-integration/patch/gpt-oss-service.cjs')
const report='C:/Nori/.work/reports/qwen-final-answer-budget-probe.json'
assert.ok(!existsSync(report),'Existing evidence preserved')
const service=await startGptOssService({root:'C:/Program Files/Nori/resources/NoriSuite',modelProfile:'qwen3.5-9b',contextTokens:65536})
const results=[]
try{
 for(const disabled of [false,true]){
  const response=await fetch(service.endpoint+'/v1/chat/completions',{method:'POST',headers:{'content-type':'application/json'},
   signal:AbortSignal.timeout(90000),body:JSON.stringify({model:service.modelId,messages:[{role:'user',content:'Reply exactly NORI_CORE_LINK_OK.'}],
    temperature:0,max_tokens:128,...(disabled?{chat_template_kwargs:{enable_thinking:false}}:{})})})
  assert.equal(response.status,200)
  const result=await response.json(),choice=result.choices[0],message=choice.message
  // Record response metrics only; do not save or expose internal reasoning.
  results.push({thinkingExplicitlyDisabled:disabled,finishReason:choice.finish_reason,
   finalContentCharacters:message.content?.length??0,reasoningFieldCharacters:message.reasoning_content?.length??0,
   finalAnswer:disabled?message.content:null,usage:result.usage})
 }
 assert.equal(results[1].finalAnswer.trim(),'NORI_CORE_LINK_OK')
}finally{
 await service.stop();const result={model:'qwen3.5-9b',contextTokens:65536,results,ownedEngineStopped:true,reasoningTextSaved:false}
 writeFileSync(report,JSON.stringify(result,null,2),{flag:'wx'});console.log(JSON.stringify(result))
}
