// 2026-11-18: Nori must start even when no local model fits yet, and load one by herself once memory frees up.
const test=require('node:test'),assert=require('node:assert/strict'),{createServer}=require('node:http')
const {startAutomaticTextService}=require('../desktop/automatic-text-service.cjs')

async function fakeModel({profile,contextTokens}){
 let exit;const exited=new Promise(resolve=>{exit=resolve})
 const server=createServer((req,res)=>{res.setHeader('content-type','application/json');res.end(JSON.stringify({model:profile,choices:[{message:{content:'ok'}}]}))})
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
 return {modelId:profile,contextTokens,endpoint:'http://127.0.0.1:'+server.address().port,exited,
  stop:async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));exit({unexpected:false})}}
}

test('no model fits at start: the service still starts, answers 503, and loads the model by itself when memory frees up',async()=>{
 let fits=false
 const events=[],starts=[]
 const service=await startAutomaticTextService({port:0,loadRetryMs:50,canLoad:async()=>fits,onEvent:event=>events.push(event.event),
  startModel:async options=>{starts.push(options.profile);return fakeModel(options)}})
 try{
  assert.ok(service.endpoint.startsWith('http://127.0.0.1:'),'the service is up without a model')
  assert.ok(events.includes('start-without-model'))
  assert.equal(starts.length,0)
  // Nori's core checks /health before it starts: the service must say it is up, and that the model loads on demand.
  const health=await (await fetch(service.endpoint+'/health')).json()
  assert.deepEqual(health,{status:'ok',model:'loads-on-demand'})
  const response=await fetch(service.endpoint+'/v1/chat/completions',{method:'POST',headers:{'content-type':'application/json'},
   body:JSON.stringify({model:'nori-auto',messages:[{role:'user',content:'hi'}],max_tokens:8})})
  assert.equal(response.status,503,'a request while memory is short gets the not-enough-memory answer')
  fits=true
  for(let i=0;i<60&&service.routingStatus.state!=='ready';i++)await new Promise(resolve=>setTimeout(resolve,25))
  assert.equal(service.routingStatus.state,'ready','the retry loaded a model without any request')
  assert.ok(events.includes('model-loaded-after-wait'))
  const loaded=starts.length
  await new Promise(resolve=>setTimeout(resolve,200))
  assert.equal(starts.length,loaded,'retrying stops once a model is loaded')
 }finally{await service.stop()}
})

test('any other start error still fails the start',async()=>{
 await assert.rejects(startAutomaticTextService({port:0,loadRetryMs:50,canLoad:async()=>true,startModel:async()=>{throw Error('engine missing')}}),/engine missing/)
})

test('the retry interval is validated like the other watchdog settings',async()=>{
 await assert.rejects(startAutomaticTextService({port:0,loadRetryMs:0,canLoad:async()=>true,startModel:fakeModel}),/Invalid automatic-model watchdog setting/)
})
