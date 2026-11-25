'use strict'
const test=require('node:test'),assert=require('node:assert/strict')
const {createTaskModelRouter}=require('../desktop/task-model-router.cjs')

function fixture({largeFits=false,smallFits=true}={}){
 const starts=[]
 const router=createTaskModelRouter({preferSecondary:()=>true,
  canLoad:async profile=>profile==='qwen3-14b'?largeFits:profile==='qwen3.5-9b'?smallFits:true,
  startModel:async({profile,contextTokens})=>{
   starts.push([profile,contextTokens]);let exit
   return {modelId:profile,contextTokens,exited:new Promise(resolve=>{exit=resolve}),stop:async()=>exit()}
  }})
 return {router,starts,run:options=>router.run({kind:'conversation',execute:async result=>result,...options})}
}

test('streaming keeps the 14B at its own 32K floor when capacity qualifies',async()=>{
 const f=fixture({largeFits:true})
 try{await f.run();assert.deepEqual(f.starts,[['qwen3-14b',32768]])}finally{await f.router.stop()}
})
test('streaming falls directly to 9B at 64K when the 14B does not fit',async()=>{
 const f=fixture()
 try{const result=await f.run();assert.equal(result.reason,'stream_mode_capacity_unavailable');assert.deepEqual(f.starts,[['qwen3.5-9b',65536]])}finally{await f.router.stop()}
})
test('streaming fails instead of choosing a model below its floor',async()=>{
 const f=fixture({smallFits:false})
 try{await assert.rejects(f.run(),{code:'LOCAL_MODEL_CAPACITY_UNAVAILABLE'});assert.deepEqual(f.starts,[])}finally{await f.router.stop()}
})
test('prompt plus requested output must fit, including on a reused fallback',async()=>{
 const f=fixture()
 try{
  await f.run()
  await f.run({promptTokens:60000,outputTokens:8192})
  assert.deepEqual(f.starts,[['qwen3.5-9b',65536],['qwen3.5-9b',196608]])
  await assert.rejects(f.run({promptTokens:196000,outputTokens:8192}),{code:'LOCAL_MODEL_CAPACITY_UNAVAILABLE'})
 }finally{await f.router.stop()}
})
test('only a profile that states its own floor may run below 64K',()=>{
 const {importedModelProfile}=require('../desktop/imported-model-profile.cjs')
 assert.equal(importedModelProfile('qwen3-14b').minimumContext,32768)
 for(const id of ['qwen3.5-9b','qwen3.6-35b','qwen3-24b-freedom','qwen3.8-27b'])assert.equal(importedModelProfile(id).minimumContext,undefined,id)
 assert.equal(require('../desktop/task-model-router.cjs').MIN_CONTEXT_TOKENS,65536)
})
