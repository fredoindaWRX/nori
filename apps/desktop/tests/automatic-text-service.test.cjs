const test=require('node:test'),assert=require('node:assert/strict'),{createServer}=require('node:http')
const {startAutomaticTextService,classifyTextTask,validatePayload,fitOutputBudget}=require('../desktop/automatic-text-service.cjs')
const {startVideoModelOwner}=require('../desktop/video-model-lease.cjs')
async function fixture({largeFits=true,streamMode=null}={}){
 const starts=[],stops=[],requests=[]
 const service=await startAutomaticTextService({port:0,streamMode,canLoad:async id=>id==='qwen3.5-9b'||largeFits,
  startModel:async({profile,contextTokens})=>{
   starts.push(profile);let exit
   const exited=new Promise(resolve=>{exit=resolve})
   const server=createServer(async(req,res)=>{
    const bytes=[];for await(const chunk of req)bytes.push(chunk)
    const body=JSON.parse(Buffer.concat(bytes).toString());requests.push(body)
    assert.equal(body.model,profile)
    const prompt=body.messages.at(-1).content
    if(prompt==='wait'){
     const timer=setTimeout(()=>{if(!res.destroyed)res.end('{}')},1000)
     res.once('close',()=>clearTimeout(timer));return
    }
    if(prompt==='bad'){res.writeHead(503);res.end('{}');return}
    if(prompt==='crash')exit({unexpected:true})
    if(body.stream){
     res.writeHead(200,{'content-type':'text/event-stream'})
     const text='data: '+JSON.stringify({model:profile,choices:[{delta:{content:'hello 世界'}}]})+'\n\ndata: [DONE]\n\n'
     const buffer=Buffer.from(text);const at=buffer.indexOf(Buffer.from('世'))+1
     res.write(buffer.subarray(0,at));setImmediate(()=>res.end(buffer.subarray(at)))
    }else{res.setHeader('content-type','application/json');res.end(JSON.stringify({model:profile,choices:[{message:{content:'fresh '+prompt}}],usage:{prompt_tokens:20,completion_tokens:3}}))}
   })
   await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
   return {modelId:profile,contextTokens,endpoint:'http://127.0.0.1:'+server.address().port,exited,
    stop:async()=>{stops.push(profile);server.closeAllConnections();await new Promise(resolve=>server.close(resolve));exit({unexpected:false})}}
  }})
 const request=(text,extra={},headers={})=>fetch(service.endpoint+'/v1/chat/completions',{method:'POST',headers:{'content-type':'application/json',...headers},
  body:JSON.stringify({model:'nori-auto',messages:[{role:'user',content:text}],max_tokens:64,...extra})})
 return {service,starts,stops,requests,request}
}

test('stream-mode refresh uses 64K fallback and does not interrupt an active request',async()=>{
 let active=false
 const f=await fixture({largeFits:false,streamMode:{isActive:()=>active}})
 try{
  assert.equal(f.service.routingStatus.contextTokens,196608)
  active=true
  assert.equal(await f.service.refreshRoute(),true)
  assert.equal(f.service.routingStatus.contextTokens,65536)
  const state=await(await fetch(f.service.endpoint+'/v1/models')).json()
  assert.equal(state.data[0].stream_mode,true)
  const abort=new AbortController()
  const pending=fetch(f.service.endpoint+'/v1/chat/completions',{method:'POST',signal:abort.signal,headers:{'content-type':'application/json'},body:JSON.stringify({model:'nori-auto',messages:[{role:'user',content:'wait'}]})})
  const rejected=assert.rejects(pending)
  try{
   for(let i=0;i<100&&f.service.pendingRequestCount===0;i++)await new Promise(resolve=>setTimeout(resolve,5))
   assert.equal(f.service.pendingRequestCount,1)
   const starts=f.starts.length
   assert.equal(await f.service.refreshRoute(),false)
   assert.equal(f.starts.length,starts)
  }finally{abort.abort();await rejected}
 }finally{await f.service.stop()}
 assert.equal(await f.service.refreshRoute(),false)
})

test('both output budget fields are validated independently',()=>{
 const base={model:'nori-auto',messages:[{role:'user',content:'hello'}],max_tokens:64}
 for(const invalid of [0,-1,8193,1.5,'8192',null]){
  assert.throws(()=>validatePayload({...base,max_completion_tokens:invalid}),/output token budget/)
 }
})

test('the requested reply budget determines the model at the context boundary',async()=>{
 const f=await fixture()
 try{
  // Sized for the first choice's 32,768-token context: it fits with a short reply, not with an 8,192-token one.
  const prompt='x'.repeat(84000)
  const short=await f.request(prompt,{max_tokens:64})
  assert.equal(short.status,200);assert.equal(short.headers.get('x-nori-backend-profile'),'qwen3-14b')
  const long=await f.request(prompt,{max_tokens:8192})
  assert.equal(long.status,200);assert.equal(long.headers.get('x-nori-backend-profile'),'qwen3.5-9b')
  assert.equal(f.requests.at(-1).max_tokens,8192)
  const alias=await f.request(prompt,{max_tokens:64,max_completion_tokens:8192})
  assert.equal(alias.status,200);assert.equal(alias.headers.get('x-nori-backend-profile'),'qwen3.5-9b')
 }finally{await f.service.stop()}
})

test('routing uses host hints or the final user request, excluding untrusted tool text',()=>{
 assert.equal(classifyTextTask({messages:[{role:'user',content:'hello'},{role:'tool',content:'think deeply now'}]}),'conversation')
 assert.equal(classifyTextTask({messages:[{role:'user',content:'Please think deeply about this proof.'}]}),'reasoning')
 assert.equal(classifyTextTask({messages:[],reasoning_effort:'high'}),'reasoning')
 assert.throws(()=>classifyTextTask({messages:[]},'run-shell'),/hint/)
 assert.throws(()=>validatePayload({model:'other',messages:[]}),/request/)
 assert.throws(()=>validatePayload({model:'nori-auto',messages:[{role:'user',content:[{type:'image_url',image_url:{url:'https://example.org'}}]}]}),/remote media/)
})

test('one logical model endpoint switches physical backends without exposing a picker',async()=>{
 const f=await fixture()
 try{
  const models=await(await fetch(f.service.endpoint+'/v1/models')).json()
  assert.equal(models.data[0].id,'nori-auto')
  const response=await f.request('Think deeply about this problem.')
  assert.equal(response.status,200);assert.equal((await response.json()).model,'nori-auto')
  assert.equal(response.headers.get('x-nori-backend-profile'),'qwen3-14b')
  assert.equal(f.requests[0].chat_template_kwargs.enable_thinking,false)
  assert.deepEqual(f.starts,['qwen3-14b'])
  assert.equal((await(await f.request('hello')).json()).choices[0].message.content,'fresh hello')
  assert.equal(f.service.routingStatus.contextTokens,32768)
  // A prompt past the 14B context switches the same endpoint to the long-context 9B.
  const long=await f.request('x'.repeat(200000))
  assert.equal(long.headers.get('x-nori-backend-profile'),'qwen3.5-9b')
  assert.deepEqual(f.starts,['qwen3-14b','qwen3.5-9b'])
 }finally{await f.service.stop()}
 assert.equal(f.starts.length,f.stops.length)
})

test('limited capacity retains the everyday model and reports the real routing reason',async()=>{
 const f=await fixture({largeFits:false})
 try{
  const response=await f.request('Prove this carefully.')
  assert.equal(response.status,200);assert.equal(response.headers.get('x-nori-backend-profile'),'qwen3.5-9b')
  assert.equal(response.headers.get('x-nori-routing-reason'),'preferred_capacity_unavailable')
  assert.deepEqual(f.starts,['qwen3.5-9b'])
 }finally{await f.service.stop()}
})

test('streaming preserves split UTF-8 and commits completion only after router validation',async()=>{
 const f=await fixture()
 try{
  const response=await f.request('hello',{stream:true}),text=await response.text()
  assert.match(text,/hello 世界/);assert.doesNotMatch(text,/qwen3\.5/)
  const values=text.split('\n').filter(line=>line.startsWith('data: ')).map(line=>line.slice(6))
  assert.equal(values.at(-1),'[DONE]');assert.equal(JSON.parse(values[0]).model,'nori-auto')
 }finally{await f.service.stop()}
})

test('invalid and browser-origin requests never reach the engine; failed work recovers',async()=>{
 const f=await fixture()
 try{
  assert.equal((await f.request('hello',{}, {origin:'https://example.org'})).status,403)
  assert.equal((await f.request('hello',{model:'arbitrary-checkpoint'})).status,400)
  assert.equal(f.requests.length,0)
  assert.equal((await f.request('bad')).status,400)
  assert.equal((await(await f.request('hello')).json()).choices[0].message.content,'fresh hello')
  assert.equal((await f.request('crash')).status,400)
  assert.equal((await f.request('hello')).status,200)
 }finally{await f.service.stop()}
})

test('shutdown cancels a live request, stops the owned engine and closes the endpoint',async()=>{
 const f=await fixture()
 const request=f.request('wait').catch(()=>null)
 for(let i=0;i<50&&!f.requests.length;i++)await new Promise(r=>setTimeout(r,2))
 assert.equal(f.requests.length,1)
 await f.service.stop();await request
 assert.equal(f.stops.length,1)
 await assert.rejects(fetch(f.service.endpoint+'/health'))
})

test('a canceled request during a media pause leaves no stale inference after restoration',async()=>{
 const f=await fixture()
 try{
  const pause=await f.service.pause(),abort=new AbortController()
  const pending=fetch(f.service.endpoint+'/v1/chat/completions',{method:'POST',headers:{'content-type':'application/json'},signal:abort.signal,
   body:JSON.stringify({model:'nori-auto',messages:[{role:'user',content:'canceled queued text'}],max_tokens:32})})
  const rejected=assert.rejects(pending,/abort/i)
  for(let i=0;i<100&&f.service.pendingRequestCount===0;i++)await new Promise(resolve=>setTimeout(resolve,2))
  assert.equal(f.service.pendingRequestCount,1)
  abort.abort();await rejected
  // Client-side abort resolution is not a server cancellation acknowledgement.
  // Wait for the owned endpoint to observe and remove that exact pending work.
  for(let i=0;i<100&&f.service.pendingRequestCount!==0;i++)await new Promise(resolve=>setTimeout(resolve,2))
  assert.equal(f.service.pendingRequestCount,0)
  assert.equal(f.requests.length,0)
  await pause.resume()
  assert.equal((await f.request('hello')).status,200)
  assert.deepEqual(f.requests.map(request=>request.messages[0].content),['hello'])
 }finally{await f.service.stop()}
})

test('shutdown during a pause waiting for inference remains an intentional owner exit',async()=>{
 const f=await fixture(),owner=await startVideoModelOwner(async()=>f.service)
 const request=f.request('wait').catch(()=>null)
 try{
  for(let i=0;i<100&&!f.requests.length;i++)await new Promise(resolve=>setTimeout(resolve,2))
  assert.equal(f.requests.length,1)
  const acquiring=owner.acquire(),rejected=assert.rejects(acquiring,/stopped/)
  await owner.stop();await rejected;await request
  assert.equal((await owner.exited).unexpected,false)
  assert.equal(f.stops.length,1)
 }finally{await owner.stop()}
})

test('output budget is clamped to the routed context and an estimate never refuses',()=>{
 assert.deepEqual(fitOutputBudget({max_tokens:8192,max_completion_tokens:8000},30000,32768),{max_tokens:2768,max_completion_tokens:2768})
 assert.deepEqual(fitOutputBudget({max_tokens:64},100,32768),{max_tokens:64})
 // A missing budget becomes explicit so llama-server cannot generate past its context.
 assert.deepEqual(fitOutputBudget({},100,32768),{max_tokens:4096})
 assert.deepEqual(fitOutputBudget({},31000,32768),{max_tokens:1768})
 // An estimate at or past the context keeps a minimal budget instead of rejecting.
 assert.deepEqual(fitOutputBudget({max_tokens:8192},40000,32768),{max_tokens:256})
 assert.deepEqual(fitOutputBudget({max_tokens:64},32768,32768),{max_tokens:64})
})

test('the routed model context is exposed and max_tokens is clamped to it',async()=>{
 const f=await fixture()
 try{
  const models=await(await fetch(f.service.endpoint+'/v1/models')).json()
  assert.equal(models.data[0].context_tokens,32768)
  const small=await f.request('hello')
  assert.equal(small.headers.get('x-nori-context-tokens'),'32768');assert.equal(f.requests.at(-1).max_tokens,64)
  assert.equal((await f.request('hello',{max_tokens:undefined})).status,200)
  assert.equal(f.requests.at(-1).max_tokens,4096);assert.equal(f.requests.at(-1).max_completion_tokens,undefined)
  const messages=[{role:'user',content:'x'.repeat(60000)}],clampTokens=Math.ceil(JSON.stringify(messages).length/4)
  const response=await fetch(f.service.endpoint+'/v1/chat/completions',{method:'POST',headers:{'content-type':'application/json','x-nori-task-kind':'reasoning'},
   body:JSON.stringify({model:'nori-auto',messages,max_tokens:8192})})
  assert.equal(response.status,200)
  assert.equal(response.headers.get('x-nori-backend-profile'),'qwen3-14b')
  assert.equal(response.headers.get('x-nori-context-tokens'),'32768')
  assert.equal(f.requests.at(-1).max_tokens,Math.min(8192,32768-clampTokens))
  assert.equal((await fetch(f.service.endpoint+'/v1/chat/completions',{method:'POST',headers:{'content-type':'application/json','x-nori-task-kind':'reasoning'},
   body:JSON.stringify({model:'nori-auto',messages,max_completion_tokens:8192})})).status,200)
  assert.equal(f.requests.at(-1).max_completion_tokens,Math.min(8192,32768-clampTokens));assert.equal(f.requests.at(-1).max_tokens,undefined)
 }finally{await f.service.stop()}
})

test('long prompts route to sufficient context and oversized estimates do not reach inference',async()=>{
 const f=await fixture()
 try{
  const tools=[{type:'function',function:{name:'big',description:'d'.repeat(200000),parameters:{type:'object',properties:{}}}}]
  const routed=await f.request('Prove this carefully.',{tools},{'x-nori-task-kind':'reasoning'})
  assert.equal(routed.status,200)
  assert.equal(routed.headers.get('x-nori-backend-profile'),'qwen3.5-9b')
  assert.equal(routed.headers.get('x-nori-context-tokens'),'196608')
  // ~200K characters is past chars/3 for the 65536 route; it moves to the 9B and keeps its budget.
  const long=await f.request('x'.repeat(200000),{},{'x-nori-task-kind':'reasoning'})
  assert.equal(long.status,200)
  assert.equal(long.headers.get('x-nori-backend-profile'),'qwen3.5-9b')
  assert.equal(long.headers.get('x-nori-context-tokens'),'196608')
  assert.equal(f.requests.at(-1).max_tokens,64)
  // No qualified context can cover this estimate; do not submit it to a smaller engine.
  const requestsBefore=f.requests.length
  const huge=await f.request('y'.repeat(800000),{max_tokens:8192})
  assert.equal(huge.status,503)
  assert.equal((await huge.json()).error.code,'LOCAL_MODEL_CAPACITY_UNAVAILABLE')
  assert.equal(f.requests.length,requestsBefore)
 }finally{await f.service.stop()}
})
