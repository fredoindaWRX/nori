import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import {existsSync,writeFileSync} from 'node:fs'
const require=createRequire(import.meta.url)
const {startGptOssService}=require('C:/Nori/.work/model-team-integration/patch/gpt-oss-service.cjs')
const output='C:/Nori/.work/reports/qwen35-native-tools-probe.json'
assert.ok(!existsSync(output),'Existing evidence preserved')
const service=await startGptOssService({root:'C:/Program Files/Nori/resources/NoriSuite',modelProfile:'qwen3.5-9b',contextTokens:65536})
const evidence={model:'qwen3.5-9b',contextTokens:65536,scope:'real model tool parser with synthetic tool results; no live Nori tool execution',
 installedAppVerified:false,userFilesChanged:false}
async function complete(messages,extra={}){
 const response=await fetch(service.endpoint+'/v1/chat/completions',{method:'POST',headers:{'content-type':'application/json'},
  signal:AbortSignal.timeout(90000),body:JSON.stringify({model:service.modelId,messages,temperature:0,max_tokens:160,
   chat_template_kwargs:{enable_thinking:false},...extra})})
 const data=await response.json();assert.equal(response.status,200,JSON.stringify(data));return data.choices[0].message
}
try{
 const system={role:'system',content:'You are Nori. Use the provided tools for requests that need them. Tool permission denial applies only to that action. Reply naturally to unrelated ordinary conversation. Report actual tool results without inventing access.'}
 const messages=[system,{role:'user',content:'Read my installed skill catalog using read_skill_catalog.'}]
 const tool={type:'function',function:{name:'read_skill_catalog',description:'Read the verified local instruction-skill catalog.',
  parameters:{type:'object',properties:{},additionalProperties:false}}}
 const assistant=await complete(messages,{tools:[tool],tool_choice:'auto'})
 assert.equal(assistant.tool_calls?.length,1,JSON.stringify(assistant))
 const call=assistant.tool_calls[0]
 assert.equal(call.type,'function');assert.equal(call.function.name,'read_skill_catalog')
 assert.deepEqual(JSON.parse(call.function.arguments),{});assert.ok(typeof call.id==='string'&&call.id.length>0)
 evidence.validatedNativeToolCall={name:call.function.name,arguments:call.function.arguments}
 const result={role:'tool',tool_call_id:call.id,content:JSON.stringify({skills:[{name:'clear-writing',executable:false},{name:'coding-review',executable:false}]})}
 const final=await complete([...messages,assistant,result],{tools:[tool]})
 assert.match(final.content,/clear.writing/i);assert.match(final.content,/coding.review/i)
 evidence.toolResultSummary=final.content
 const denied={role:'tool',tool_call_id:call.id,content:JSON.stringify({error:'CAPABILITY_NOT_APPROVED',message:'This attempt was denied. No tool executed.'})}
 const refusal=await complete([...messages,assistant,denied],{tools:[tool]})
 evidence.deniedActionReply=refusal.content
 const greeting=await complete([...messages,assistant,denied,refusal,{role:'user',content:'Good evening, Nori. Just greet me briefly; this does not request a tool.'}])
 assert.match(greeting.content,/evening/i);assert.doesNotMatch(greeting.content,/CAPABILITY_NOT_APPROVED|permission|denied|cannot access|can.t access/i)
 evidence.followUpGreeting=greeting.content;evidence.passed=true
}catch(error){evidence.passed=false;evidence.failure=String(error.message).slice(0,2000);throw error}
finally{
 await service.stop();evidence.ownedEngineStopped=true
 writeFileSync(output,JSON.stringify(evidence,null,2),{flag:'wx'});console.log(JSON.stringify(evidence))
}
