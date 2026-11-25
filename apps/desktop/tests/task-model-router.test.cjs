const test=require('node:test'),assert=require('node:assert/strict')
const {createTaskModelRouter,textTaskRoute}=require('../desktop/task-model-router.cjs')
// Each model starts at its own qualified context: the first-choice Qwen3 14B at 32768 (its own floor,
// owner 2026-11-17), the 9B fallback at 196608.
// The text-only 24B-A4B middle tier runs at 32768.
const qualified=profile=>profile==='qwen3-14b'?32768:profile==='qwen3-24b-freedom'?32768:196608
function fixture({failLarge=false,failMid=false,largeFits=true,midFits=false,smallFits=true,context=null,drainTimeoutMs=15000}={}){
 const starts=[],stops=[],services=[]
 const router=createTaskModelRouter({drainTimeoutMs,canLoad:async id=>id==='qwen3.5-9b'?smallFits:id==='qwen3-24b-freedom'?midFits:largeFits,
  startModel:async({profile,contextTokens,signal})=>{
   starts.push(profile);signal.throwIfAborted();assert.equal(contextTokens,qualified(profile))
   if(failLarge&&profile==='qwen3-14b')throw Error('Synthetic allocation failure')
   if(failMid&&profile==='qwen3-24b-freedom')throw Error('Synthetic middle-tier failure')
   let exit;const exited=new Promise(resolve=>{exit=resolve})
   const service={modelId:profile,contextTokens:context??qualified(profile),exited,stop:async()=>{stops.push(profile);exit({unexpected:false})},exit}
   services.push(service);return service
  }})
 return {router,starts,stops,services}
}
test('host task routes distinguish worker choice without accepting arbitrary model paths',()=>{
 assert.equal(textTaskRoute('coding').worker,'aider')
 assert.equal(textTaskRoute('code-review').preferred,'qwen3-14b')
 assert.equal(textTaskRoute('conversation').preferred,'qwen3-14b')
 for(const value of ['C:/untrusted.gguf','install','__proto__',{},null])assert.throws(()=>textTaskRoute(value),/Unsupported/)
 assert.throws(()=>createTaskModelRouter({startModel(){}}),/capacity/)
})
test('serialized tasks switch owned models behind the scenes at each model qualified context',async()=>{
 const f=fixture();let active=0
 const execute=async info=>{assert.equal(++active,1);await new Promise(r=>setTimeout(r,3));active--;return info.modelId}
 const results=await Promise.all([f.router.run({kind:'conversation',execute}),f.router.run({kind:'conversation',promptTokens:120000,execute}),f.router.run({kind:'coding',execute})])
 assert.deepEqual(results,['qwen3-14b','qwen3.5-9b','qwen3-14b'])
 await f.router.stop();assert.equal(f.router.status.state,'stopped');assert.equal(f.stops.length,3)
})
test('capacity and startup failures fall back honestly without lowering context',async()=>{
 for(const options of [{largeFits:false},{failLarge:true}]){
  const f=fixture(options)
  const result=await f.router.run({kind:'reasoning',execute:async info=>info})
  assert.equal(result.modelId,'qwen3.5-9b');assert.equal(result.contextTokens,196608)
  assert.match(result.reason,/unavailable|failed/);await f.router.stop()
 }
 const f=fixture({context:4096})
 await assert.rejects(f.router.run({kind:'conversation',execute:async()=>assert.fail('Wrong context executed')}),/context/)
 // The 14B and then the 9B fallback both report the wrong context; neither runs.
 assert.equal(f.stops.length,2);await f.router.stop()
})
test('a failed action does not repeat it or contaminate the next conversation',async()=>{
 const f=fixture();let calls=0
 await assert.rejects(f.router.run({kind:'coding',execute:async()=>{calls++;throw Error('Denied synthetic action')}}),/Denied/)
 assert.equal(await f.router.run({kind:'conversation',execute:async()=> 'fresh reply'}),'fresh reply')
 assert.equal(calls,1);assert.deepEqual(f.starts,['qwen3-14b']);await f.router.stop()
})
test('canceling a queued task does not launch it, and a running task must quiesce',async()=>{
 const f=fixture(),abort=new AbortController();let release,entered
 const started=new Promise(resolve=>{entered=resolve}),gate=new Promise(resolve=>{release=resolve})
 const first=f.router.run({kind:'coding',signal:abort.signal,execute:async()=>{entered();await gate;return 'late success'}})
 const rejected=assert.rejects(first,/canceled/);await started;abort.abort(Error('canceled'))
 const next=f.router.run({kind:'reasoning',execute:async()=> 'next'})
 await new Promise(r=>setTimeout(r,5));assert.deepEqual(f.starts,['qwen3-14b'])
 release();await rejected;assert.equal(await next,'next')
 const queuedAbort=new AbortController();queuedAbort.abort(Error('queued canceled'))
 await assert.rejects(f.router.run({kind:'conversation',signal:queuedAbort.signal,execute:async()=>assert.fail()}),/queued canceled/)
 assert.equal(f.starts.length,1);await f.router.stop()
})
test('an unexpected owned engine exit cannot produce a successful completion',async()=>{
 const f=fixture()
 await assert.rejects(f.router.run({kind:'conversation',execute:async()=>{f.services[0].exit({unexpected:true});await Promise.resolve();return 'false success'}}),/stopped/)
 assert.equal(await f.router.run({kind:'conversation',execute:async()=> 'recovered'}),'recovered')
 assert.equal(f.starts.length,2);await f.router.stop()
})

test('a worker ignoring cancellation causes bounded shutdown failure and prevents reuse',async()=>{
 const f=fixture({drainTimeoutMs:5});let release,entered
 const started=new Promise(resolve=>{entered=resolve}),gate=new Promise(resolve=>{release=resolve})
 const task=f.router.run({kind:'coding',execute:async()=>{entered();await gate;return 'late'}})
 const rejected=assert.rejects(task,/stopped/);await started
 await assert.rejects(f.router.stop(),/quiesce/)
 assert.equal(f.router.status.state,'failed');assert.equal(f.stops.length,1)
 await assert.rejects(f.router.run({kind:'conversation',execute:async()=>assert.fail()}),/stopped/)
 release();await rejected
})

test('a loaded model cannot serve a prompt exceeding its context when no larger model fits',async()=>{
 const f=fixture({smallFits:false})
 assert.equal(await f.router.run({kind:'reasoning',execute:async info=>info.modelId}),'qwen3-14b')
 await assert.rejects(f.router.run({kind:'conversation',promptTokens:120000,execute:async()=>assert.fail('Oversized prompt executed')}),{code:'LOCAL_MODEL_CAPACITY_UNAVAILABLE'})
 assert.equal(f.starts.length,1);await f.router.stop()
})

test('owned capacity checks can re-measure after release instead of falsely rejecting a fitting model',async()=>{
 const started=[],stopped=[]
 const capacity=async(id,{current})=>id==='qwen3.5-9b'||!current
 capacity.recheckAfterUnload=true
 const router=createTaskModelRouter({canLoad:capacity,startModel:async({profile,contextTokens})=>{
  started.push(profile);let exit
  return {modelId:profile,contextTokens,exited:new Promise(r=>{exit=r}),stop:async()=>{stopped.push(profile);exit()}}
 }})
 await router.run({kind:'conversation',promptTokens:120000,execute:async()=>{}})
 const result=await router.run({kind:'reasoning',execute:async route=>route})
 assert.equal(result.modelId,'qwen3-14b');assert.equal(result.reason,'preferred_after_owned_release')
 assert.deepEqual(started,['qwen3.5-9b','qwen3-14b']);assert.deepEqual(stopped,['qwen3.5-9b'])
 await router.stop()
})

test('capacity changing during a switch cannot start the now-unfitting large model',async()=>{
 const started=[]
 const capacity=async(id,{current})=>id==='qwen3.5-9b'||Boolean(current)
 capacity.recheckAfterUnload=true
 const router=createTaskModelRouter({canLoad:capacity,startModel:async({profile,contextTokens})=>{
  started.push(profile);let exit
  return {modelId:profile,contextTokens,exited:new Promise(r=>{exit=r}),stop:async()=>exit()}
 }})
 await router.run({kind:'conversation',promptTokens:120000,execute:async()=>{}})
 const result=await router.run({kind:'reasoning',execute:async route=>route})
 assert.equal(result.modelId,'qwen3.5-9b');assert.equal(result.reason,'preferred_capacity_changed')
 assert.deepEqual(started,['qwen3.5-9b','qwen3.5-9b']);await router.stop()
})

test('a prompt longer than the 14B context is routed to the long-context 9B',async()=>{
 const f=fixture()
 const long=await f.router.run({kind:'reasoning',promptTokens:120000,execute:async info=>info})
 assert.equal(long.modelId,'qwen3.5-9b');assert.equal(long.contextTokens,196608)
 const short=await f.router.run({kind:'reasoning',promptTokens:2000,execute:async info=>info})
 assert.equal(short.modelId,'qwen3-14b');assert.equal(short.contextTokens,32768)
 // 30,000 prompt tokens plus the 4,096 reserved for the reply do not fit in 32,768.
 const edge=await f.router.run({kind:'reasoning',promptTokens:30000,execute:async info=>info})
 assert.equal(edge.modelId,'qwen3.5-9b')
 assert.equal(textTaskRoute('vision').preferred,'qwen3.5-9b','the 14B has no projector')
 await f.router.stop()
})
test('text and coding tasks skip the sub-64K middle tier even when it fits',async()=>{
 const f=fixture({largeFits:false,midFits:true})
 const result=await f.router.run({kind:'conversation',execute:async info=>info})
 assert.equal(result.modelId,'qwen3.5-9b');assert.equal(result.contextTokens,196608)
 assert.equal(result.reason,'preferred_capacity_unavailable');assert.deepEqual(f.starts,['qwen3.5-9b'])
 // The qualified fallback is reused for coding without changing worker permissions.
 const next=await f.router.run({kind:'coding',execute:async info=>info.modelId})
 assert.equal(next,'qwen3.5-9b');assert.deepEqual(f.starts,['qwen3.5-9b']);await f.router.stop()
})
test('vision and prompts longer than the middle tier context skip it for the 9B',async()=>{
 for(const task of [{kind:'vision'},{kind:'conversation',promptTokens:30000}]){
  const f=fixture({largeFits:false,midFits:true})
  const result=await f.router.run({...task,execute:async info=>info})
  assert.equal(result.modelId,'qwen3.5-9b',JSON.stringify(task));assert.ok(!f.starts.includes('qwen3-24b-freedom'))
  await f.router.stop()
 }
})
test('a failed 14B start falls directly to the qualified 9B',async()=>{
 let f=fixture({failLarge:true,midFits:true})
 let result=await f.router.run({kind:'research',execute:async info=>info})
 assert.equal(result.modelId,'qwen3.5-9b');assert.equal(result.reason,'preferred_startup_failed');await f.router.stop()
 f=fixture({failLarge:true,failMid:true,midFits:true})
 result=await f.router.run({kind:'research',execute:async info=>info})
 assert.equal(result.modelId,'qwen3.5-9b');assert.deepEqual(f.starts,['qwen3-14b','qwen3.5-9b']);await f.router.stop()
})
test('when the middle tier does not fit either, the 9B still serves',async()=>{
 const f=fixture({largeFits:false,midFits:false})
 const result=await f.router.run({kind:'conversation',execute:async info=>info})
 assert.equal(result.modelId,'qwen3.5-9b');assert.ok(!f.starts.includes('qwen3-24b-freedom'));await f.router.stop()
})
test('the router reports why the loaded model was chosen, and a reused model keeps its reason',async()=>{
 const f=fixture({largeFits:false,midFits:true})
 await f.router.run({kind:'conversation',execute:async()=>{}})
 assert.equal(f.router.status.modelId,'qwen3.5-9b');assert.equal(f.router.status.reason,'preferred_capacity_unavailable')
 assert.ok(Number.isFinite(f.router.status.since))
 await f.router.run({kind:'conversation',execute:async()=>{}})
 assert.equal(f.router.status.reason,'preferred_capacity_unavailable');await f.router.stop()
 assert.equal(f.router.status.reason,null)
})
