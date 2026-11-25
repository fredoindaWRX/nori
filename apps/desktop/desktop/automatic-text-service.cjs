'use strict'
const {createServer}=require('node:http')
const {freemem}=require('node:os')
const {CONTEXT_TOKENS,createTaskModelRouter}=require('./task-model-router.cjs')
const {MAX_VISION_REQUEST_BYTES,validateVisionMessages}=require('./vision-payload.cjs')
const {HELPER_MODEL,HELPER_CONTEXT,slimForHelper}=require('./helper-fallback.cjs')
const AUTO_MODEL_ID='nori-auto'
const FIELDS=new Set(['model','messages','max_tokens','max_completion_tokens','stream','temperature','top_p','top_k','min_p','seed','stop',
 'tools','tool_choice','parallel_tool_calls','response_format','chat_template_kwargs','reasoning_effort','stream_options',
 'frequency_penalty','presence_penalty','repeat_penalty','logprobs','top_logprobs'])

function validatePayload(body,{vision=false}={}){
 if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).some(key=>!FIELDS.has(key))||body.model!==AUTO_MODEL_ID)throw Error('Invalid automatic-model request')
 if(!Array.isArray(body.messages)||!body.messages.length||body.messages.length>128)throw Error('Invalid text messages')
 for(const message of body.messages){
  if(!message||typeof message!=='object'||!['system','developer','user','assistant','tool'].includes(message.role))throw Error('Invalid message role')
  const toolCallOnly=message.role==='assistant'&&(message.content===undefined||message.content===null)
   &&Array.isArray(message.tool_calls)&&message.tool_calls.length>0&&message.tool_calls.length<=256
  if(!vision&&typeof message.content!=='string'&&!toolCallOnly){
   if(!Array.isArray(message.content)||message.content.some(item=>!item||item.type!=='text'||typeof item.text!=='string'))throw Error('Text routing does not accept remote media')
  }
 }
 if(vision){
  if(body.tools!==undefined||body.tool_choice!==undefined||body.stream!==false)throw Error('Vision observations cannot request tool execution or streaming')
  validateVisionMessages(body.messages)
 }
 for(const key of ['max_tokens','max_completion_tokens']){
  const maximum=body[key]
  if(maximum!==undefined&&(!Number.isInteger(maximum)||maximum<1||maximum>8192))throw Error('Invalid output token budget')
 }
 if(body.stream!==undefined&&typeof body.stream!=='boolean')throw Error('Invalid streaming selection')
 if(body.tools!==undefined&&(!Array.isArray(body.tools)||body.tools.length>256))throw Error('Invalid tool catalog')
 if(body.chat_template_kwargs!==undefined&&(!body.chat_template_kwargs||typeof body.chat_template_kwargs!=='object'||Array.isArray(body.chat_template_kwargs)
  ||Object.keys(body.chat_template_kwargs).some(key=>key!=='enable_thinking')||typeof body.chat_template_kwargs.enable_thinking!=='boolean'))throw Error('Invalid local template options')
 return body
}

// Clamps the output budget to the routed context using an estimate, never refusing on it:
// llama-server tokenizes the real prompt and rejects it itself if it truly does not fit.
// A missing budget is made explicit so the engine cannot generate past its context.
function fitOutputBudget(body,promptTokens,contextTokens){
 const room=Math.max(256,contextTokens-promptTokens)
 const fitted={...body}
 if(fitted.max_tokens===undefined&&fitted.max_completion_tokens===undefined)fitted.max_tokens=Math.min(4096,room)
 for(const key of ['max_tokens','max_completion_tokens'])if(fitted[key]!==undefined)fitted[key]=Math.min(fitted[key],room)
 return fitted
}
// Prompt size in characters, including tool schemas, which are part of the rendered prompt.
function promptChars(body){return JSON.stringify(body.messages??'').length+(body.tools===undefined?0:JSON.stringify(body.tools).length)}

function classifyTextTask(body,kind){
 if(kind!==undefined){
  if(!['conversation','research','coding','reasoning','code-review','vision'].includes(kind))throw Error('Invalid host task hint')
  return kind
 }
 // Nori's local Aider worker sends no host hint; its editing system prompt marks a coding task.
 const system=body.messages[0]?.role==='system'&&typeof body.messages[0].content==='string'?body.messages[0].content:''
 if(system.startsWith('Act as an expert software developer.'))return 'coding'
 if(body.reasoning_effort==='high')return 'reasoning'
 // Inspect only the final user request, never tool output or recalled context.
 const last=body.messages.findLast(message=>message.role==='user')
 const text=typeof last?.content==='string'?last.content.trim():''
 if(/^(?:(?:please|nori)[,!:.]?\s+)?(?:critically review|perform (?:a |an )?(?:deep|security) (?:code )?(?:review|audit))\b/i.test(text))return 'code-review'
 if(/^(?:(?:please|nori)[,!:.]?\s+)?(?:reason carefully|think deeply|prove)\b/i.test(text))return 'reasoning'
 return 'conversation'
}

// This runtime accepts required selection but can terminate on a named selector.
// A singleton catalog plus required preserves the requested function and schema.
// This only adapts inference framing; host tool validation/approvals still apply.
function nativeCompatiblePayload(body){
 const choice=body.tool_choice
 if(choice===undefined||['auto','none','required'].includes(choice))return body
 if(!choice||typeof choice!=='object'||Array.isArray(choice)||choice.type!=='function'
  ||Object.keys(choice).some(key=>!['type','function'].includes(key))
  ||!choice.function||typeof choice.function!=='object'||Array.isArray(choice.function)
  ||Object.keys(choice.function).some(key=>key!=='name')
  ||typeof choice.function.name!=='string'||!/^[a-zA-Z0-9_-]{1,64}$/.test(choice.function.name))throw Error('Invalid named tool selector')
 const matches=body.tools?.filter(tool=>tool?.type==='function'&&tool.function?.name===choice.function.name)
 if(matches?.length!==1)throw Error('Named tool selector must identify one offered function')
 return {...body,tools:[matches[0]],tool_choice:'required'}
}

async function readJson(request,vision=false){
 let total=0;const chunks=[]
 for await(const chunk of request){total+=chunk.length;if(total>(vision?MAX_VISION_REQUEST_BYTES:1048576))throw Error('Local model request exceeds its byte budget');chunks.push(chunk)}
 return validatePayload(JSON.parse(Buffer.concat(chunks).toString('utf8')),{vision})
}
async function boundedJson(response){
 let text='',bytes=0
 const decoder=new TextDecoder()
 for await(const chunk of response.body){bytes+=chunk.byteLength;if(bytes>1048576)throw Error('Model response exceeds its byte budget');text+=decoder.decode(chunk,{stream:true})}
 text+=decoder.decode();return JSON.parse(text)
}
function virtualize(value,profile){
 if(!value||typeof value!=='object'||Array.isArray(value)||value.model!==profile)throw Error('Physical model response identity mismatch')
 return {...value,model:AUTO_MODEL_ID}
}

async function streamResponse(response,outgoing,profile,observe=()=>{}){
 let pending='',done=false;const decoder=new TextDecoder()
 const consume=async line=>{
  if(line.startsWith('data:')){
   const data=line.slice(5).trim()
   if(data==='[DONE]'){if(done)throw Error('Repeated stream completion');done=true;return}
   if(data){if(done)throw Error('Model data after stream completion');const value=virtualize(JSON.parse(data),profile);observe(value);line='data: '+JSON.stringify(value)}
  }else if(line&&!line.startsWith(':')&&!line.startsWith('event:'))throw Error('Unsupported model stream framing')
  if(!outgoing.write(line+'\n'))await new Promise((resolve,reject)=>{
   const drain=()=>{cleanup();resolve()},closed=()=>{cleanup();reject(Error('Client stream closed'))}
   const cleanup=()=>{outgoing.off('drain',drain);outgoing.off('close',closed)}
   outgoing.once('drain',drain);outgoing.once('close',closed)
  })
 }
 for await(const chunk of response.body){
  pending+=decoder.decode(chunk,{stream:true});if(pending.length>1048576)throw Error('Model stream line exceeded its byte budget')
  let end;while((end=pending.indexOf('\n'))>=0){const line=pending.slice(0,end).replace(/\r$/,'');pending=pending.slice(end+1);await consume(line)}
 }
 pending+=decoder.decode();if(pending.trim())await consume(pending.replace(/\r$/,''))
 if(!done)throw Error('Model stream ended without completion')
}

// Per-request speed record from llama-server's own timings, so a slow reply shows where the
// time went: waiting for/loading a model (routeMs), the first token, prompt reading and output
// speed, plus free RAM when it ended. Numbers only: no prompt or reply text is kept.
const round=(value,digits=1)=>Number.isFinite(value)?Math.round(value*10**digits)/10**digits:undefined
function timingRecord({startedAt,routeAt,firstAt,endedAt,model,kind,outcome,timings,freeRamMiB}){
 const t=timings&&typeof timings==='object'?timings:{}
 const record={at:new Date(endedAt).toISOString(),startedAt,model:typeof model==='string'?model.slice(0,40):undefined,kind,outcome,
  routeMs:Number.isFinite(routeAt)?routeAt-startedAt:undefined,firstTokenMs:Number.isFinite(firstAt)?firstAt-startedAt:undefined,totalMs:endedAt-startedAt,
  promptTokens:Number.isInteger(t.prompt_n)?t.prompt_n:undefined,cachedTokens:Number.isInteger(t.cache_n)?t.cache_n:undefined,
  promptPerSecond:round(t.prompt_per_second),outputTokens:Number.isInteger(t.predicted_n)?t.predicted_n:undefined,
  outputPerSecond:round(t.predicted_per_second),freeRamMiB:Number.isFinite(freeRamMiB)?Math.round(freeRamMiB):undefined}
 return Object.fromEntries(Object.entries(record).filter(([,value])=>value!==undefined))
}
const hasToken=value=>{const delta=value?.choices?.[0]?.delta;return Boolean(delta&&(delta.content||delta.reasoning_content||delta.tool_calls?.length))}

async function startAutomaticTextService({startModel,canLoad,port=18786,signal,requestTimeoutMs=120000,fetcher=fetch,onTiming,clock=Date.now,freeRam=()=>freemem()/1024**2,streamMode=null,helper=null,handoverMs=20000,
 onEvent,stallMs=60000,watchMs=15000,healCooldownMs=300000,loadRetryMs=60000,createRouter=createTaskModelRouter}={}){
 for(const value of [stallMs,watchMs,healCooldownMs,loadRetryMs])if(!Number.isInteger(value)||value<1)throw Error('Invalid automatic-model watchdog setting')
 if(![0,18786].includes(port))throw Error('Unsupported automatic-model listen port')
 if(!Number.isInteger(requestTimeoutMs)||requestTimeoutMs<1||requestTimeoutMs>300000)throw Error('Invalid automatic-model deadline')
 // OBS rechecks capacity: keep the 35B when it fits, otherwise use the 9B at minimum 64K.
 const streaming=()=>Boolean(streamMode?.isActive?.())
 // R84: model events (loads, failures with the engine's last error lines, exits, stalls, resets)
 // are kept and logged locally: numbers and engine diagnostics only, never prompt or reply text.
 const recentEvents=[]
 const keepEvent=event=>{
  let ram;try{ram=Math.round(freeRam())}catch{}
  const record={at:new Date(clock()).toISOString(),...event};if(Number.isFinite(ram))record.freeRamMiB=ram
  recentEvents.push(record);if(recentEvents.length>32)recentEvents.shift();try{onEvent?.(record)}catch{}
 }
 const makeRouter=()=>createRouter({startModel,canLoad,preferSecondary:streaming,onEvent:keepEvent})
 let router=makeRouter()
 const pending=new Set(),waiting=new Map(),recentTimings=[];let stopping,ready=false,resolveExit
 const keepTiming=record=>{recentTimings.push(record);if(recentTimings.length>32)recentTimings.shift();try{onTiming?.(record)}catch{}}
 const exited=new Promise(resolve=>{resolveExit=resolve})
 const server=createServer(async(request,response)=>{
  const send=(status,body)=>{if(response.destroyed)return;response.writeHead(status,{'content-type':'application/json','cache-control':'no-store'});response.end(JSON.stringify(body))}
  if(request.headers.origin){request.resume();send(403,{error:{code:'ORIGIN_REFUSED'}});return}
  // The service is up whenever it is ready to take requests; a model is loaded on demand. Before 2026-11-18 this
  // answered 503 until a model was loaded, so Nori's core refused to start (and she quit) whenever memory was short.
  if(request.method==='GET'&&request.url==='/health'){const loaded=ready&&router.status.state==='ready';send(ready?200:503,{status:ready?'ok':'unavailable',model:loaded?'loaded':ready?'loads-on-demand':'none'});return}
  if(request.method==='GET'&&request.url==='/v1/models'){send(200,{object:'list',data:[{id:AUTO_MODEL_ID,object:'model',owned_by:'nori',backend_profile:router.status.modelId,context_tokens:router.status.contextTokens,
   routing_reason:router.status.reason,routing_since:router.status.since,pending_requests:pending.size,stream_mode:streaming()}]});return}
  if(request.method==='GET'&&request.url==='/v1/nori-timings'){send(200,{object:'list',data:recentTimings});return}
  if(request.method==='GET'&&request.url==='/v1/nori-events'){send(200,{object:'list',data:recentEvents});return}
  if(request.method!=='POST'||request.url!=='/v1/chat/completions'){request.resume();send(404,{error:{code:'UNSUPPORTED_ENDPOINT'}});return}
  if(!ready||stopping){request.resume();send(503,{error:{code:'LOCAL_MODEL_UNAVAILABLE'}});return}
  if(pending.size>=4){request.resume();send(429,{error:{code:'LOCAL_MODEL_QUEUE_FULL'}});return}
  const abort=new AbortController();pending.add(abort)
  const timing={startedAt:clock(),kind:undefined,model:undefined,routeAt:undefined,firstAt:undefined,timings:undefined}
  waiting.set(abort,timing)
  // Filled once the request is read; the helper answers from it if the main route fails.
  let fallback=null
  // A request with no route after handoverMs is answered by the helper; a late main route then stays silent.
  let handedOver=false,mainSkipped=false,handoverTimer=null
  const timer=setTimeout(()=>abort.abort(Error('Local model request deadline')),requestTimeoutMs)
  abort.signal.addEventListener('abort',()=>{if(!request.complete)request.destroy()},{once:true})
  request.once('aborted',()=>abort.abort(Error('Client request canceled')))
  response.once('close',()=>{if(!response.writableFinished)abort.abort(Error('Client response canceled'))})
  // The helper could not take the request: let the main route answer, or report failure if it already passed.
  const giveBack=()=>{
   timing.model=undefined;timing.outcome=undefined
   if(mainSkipped)send(400,{error:{code:'LOCAL_ROUTING_FAILED',message:'The local model request did not complete.'}});else handedOver=false
  }
  const answerFromHelper=async({body,clampTokens})=>{
   // Slim request: the helper reads about 66 tokens/s, so it gets the last few messages, not the full prompt.
   const result=await helper(slimForHelper(body),{signal:abort.signal})
   if(!result)return false
   if(body.stream&&!result.headers.get('content-type')?.startsWith('text/event-stream'))return false
   response.setHeader('x-nori-backend-profile',HELPER_MODEL)
   response.setHeader('x-nori-routing-reason','helper_fallback')
   response.setHeader('x-nori-context-tokens',String(HELPER_CONTEXT))
   if(body.stream){
    response.writeHead(200,{'content-type':'text/event-stream','cache-control':'no-store'})
    await streamResponse(result,response,HELPER_MODEL,value=>{if(timing.firstAt===undefined&&hasToken(value))timing.firstAt=clock();if(value?.timings)timing.timings=value.timings})
    response.write('data: [DONE]\n\n');response.end()
   }else{
    const value=virtualize({...(await boundedJson(result)),model:HELPER_MODEL},HELPER_MODEL);timing.firstAt=clock();timing.timings=value.timings;send(200,value)
   }
   return true
  }
  try{
   const vision=request.headers['x-nori-task-kind']==='vision'
   const body=nativeCompatiblePayload(await readJson(request,vision))
   const kind=classifyTextTask(body,request.headers['x-nori-task-kind']);timing.kind=kind
   // ~3 characters per token overestimates, so long prompts move to the long-context 9B early.
   // ~4 characters per token is closer for the output clamp, which must not starve fitting prompts.
   const chars=promptChars(body),promptTokens=Math.ceil(chars/3),clampTokens=Math.ceil(chars/4)
   fallback={body,clampTokens,vision}
   if(helper&&!vision&&Number.isFinite(handoverMs)&&handoverMs>0)handoverTimer=setTimeout(()=>{
    if(timing.routeAt!==undefined||response.headersSent||abort.signal.aborted)return
    handedOver=true;timing.model=HELPER_MODEL;timing.outcome='helper'
    answerFromHelper(fallback).then(ok=>{if(!ok)giveBack()},()=>{if(response.headersSent)response.destroy();else giveBack()})
   },handoverMs)
   const suppliedBudgets=[body.max_tokens,body.max_completion_tokens].filter(value=>value!==undefined)
   const outputTokens=suppliedBudgets.length?Math.max(...suppliedBudgets):4096
   const completed=await router.run({kind,promptTokens,outputTokens,signal:abort.signal,execute:async route=>{
    if(handedOver){mainSkipped=true;return null}
    timing.routeAt=clock();timing.model=route.modelId
    const fitted=fitOutputBudget(body,clampTokens,route.contextTokens)
    if(vision&&route.service.capabilities?.vision!==true)throw Error('Owned local model has no verified vision projector')
    const endpoint=new URL(route.service.endpoint)
    if(endpoint.protocol!=='http:'||endpoint.hostname!=='127.0.0.1'||endpoint.pathname!=='/'||endpoint.search||endpoint.hash||endpoint.username||endpoint.password)throw Error('Owned model endpoint is not loopback')
    const result=await fetcher(endpoint.origin+'/v1/chat/completions',{method:'POST',redirect:'error',
     headers:{'content-type':'application/json'},signal:route.signal,body:JSON.stringify({...fitted,model:route.modelId,
      chat_template_kwargs:{enable_thinking:false,...body.chat_template_kwargs}})})
    if(!result.ok)throw Error('Owned model rejected the request')
    route.signal.throwIfAborted()
    response.setHeader('x-nori-backend-profile',route.modelId)
    response.setHeader('x-nori-routing-reason',route.reason)
    response.setHeader('x-nori-context-tokens',String(route.contextTokens))
    if(body.stream){
     if(!result.headers.get('content-type')?.startsWith('text/event-stream'))throw Error('Owned model did not return an event stream')
     response.writeHead(200,{'content-type':'text/event-stream','cache-control':'no-store'})
     await streamResponse(result,response,route.modelId,value=>{if(timing.firstAt===undefined&&hasToken(value))timing.firstAt=clock();if(value?.timings)timing.timings=value.timings})
     return null
    }else{
     const value=virtualize(await boundedJson(result),route.modelId);timing.firstAt=clock();timing.timings=value.timings;route.signal.throwIfAborted();return value
    }
   }})
   if(mainSkipped)return
   if(body.stream){response.write('data: [DONE]\n\n');response.end()}else send(200,completed)
   timing.outcome='ok'
  }catch(error){
   if(handedOver)return // the helper owns this reply
   // The main model failed or could not load, and nothing has been sent yet: the helper on the second
   // graphics card answers this one request. Never for vision, never after a cancel.
   let viaHelper=false
   if(helper&&fallback&&!fallback.vision&&!response.headersSent&&!abort.signal.aborted){
    try{viaHelper=await answerFromHelper(fallback)}catch{if(response.headersSent)response.destroy()}
   }
   if(viaHelper){timing.model=HELPER_MODEL;timing.outcome='helper'}else{
   if(response.headersSent)response.destroy()
   else if(!abort.signal.aborted&&error.code==='LOCAL_MODEL_CAPACITY_UNAVAILABLE')send(503,{error:{code:error.code,message:'Not enough free memory to load a local model at the configured 65,536-token context. Free RAM or GPU memory and try again.'}})
   else send(abort.signal.aborted?408:400,{error:{code:abort.signal.aborted?'LOCAL_REQUEST_CANCELED':'LOCAL_ROUTING_FAILED',message:'The local model request did not complete.'}})
   timing.outcome=!abort.signal.aborted?'failed':abort.signal.reason?.message==='Local model request deadline'?'timed-out':'canceled'
   }
  }finally{
   clearTimeout(timer);clearTimeout(handoverTimer);pending.delete(abort);waiting.delete(abort)
   if(timing.kind!==undefined)keepTiming(timingRecord({...timing,endedAt:clock(),freeRamMiB:freeRam()}))
  }
 })
 // R84 watchdog. In a week of records a real route (model load included) took at most 42 s and every
 // router step is bounded, yet her requests sometimes waited the full 120 s with no model, one after
 // another, until Nori was restarted. When a request has had no main route for stallMs and the router
 // has been in one step longer than that step can honestly take, the stuck router is stopped (its
 // owned engine with it) and a fresh one loads the model. Requests waiting on the old router fail
 // over to the helper. A pause (video work holding the card) is only reported, never reset.
 let healing=null,lastHealAt=-Infinity,pausedReported=false,watchTimer=null,loadRetryTimer=null
 const phaseLimit=phase=>phase==='paused'?Infinity:phase==='loading'?150000:phase==='executing'?requestTimeoutMs+30000:phase==='idle'?0:60000
 const heal=async snapshot=>{
  const started=clock();lastHealAt=started
  keepEvent({event:'stall',...snapshot})
  let oldStopped=true,message,limit
  try{await Promise.race([router.stop(),new Promise((_,reject)=>{limit=setTimeout(()=>reject(Error('The stuck router did not stop within 30 s')),30000)})])}
  catch(error){oldStopped=false;message=String(error?.message??error).slice(0,300)}
  finally{clearTimeout(limit)}
  if(stopping)return
  router=makeRouter()
  keepEvent({event:'router-reset',ms:clock()-started,oldStopped,...(message?{message}:{})})
  // Load the model now rather than on the owner's next message.
  router.run({kind:'conversation',signal,execute:async()=>{}}).catch(()=>{})
 }
 const watch=()=>{
  if(!ready||stopping||healing)return
  const now=clock(),activity=router.activity??{phase:'idle',since:now,profile:null}
  if(activity.phase==='paused'){
   if(!pausedReported&&now-activity.since>600000){pausedReported=true;keepEvent({event:'paused-long',minutes:Math.round((now-activity.since)/60000)})}
  }else pausedReported=false
  let oldest=Infinity
  for(const item of waiting.values())if(item.routeAt===undefined)oldest=Math.min(oldest,item.startedAt)
  if(now-oldest<stallMs||now-activity.since<=phaseLimit(activity.phase)||now-lastHealAt<healCooldownMs)return
  healing=heal({waitedMs:now-oldest,phase:activity.phase,phaseMs:now-activity.since,profile:activity.profile??null,
   routerState:router.status.state,model:router.status.modelId,pending:pending.size}).finally(()=>{healing=null})
 }
 const stop=()=>stopping??=(async()=>{
  ready=false;clearInterval(watchTimer);clearInterval(loadRetryTimer);for(const abort of pending)abort.abort(Error('Automatic text service stopped'))
  server.closeAllConnections()
  try{await healing;await router.stop()}finally{
   await new Promise(resolve=>server.close(resolve));resolveExit({unexpected:false})
  }
 })()
 try{
  signal?.throwIfAborted()
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve)})
  // 2026-11-18 (Wil: "fix it" so she always comes back on her own): when no local model fits at start (another
  // program is holding the memory), Nori used to quit with no window. Now she starts without a model: requests
  // get the existing "not enough free memory" answer and each one tries the load again, and she retries by
  // herself every loadRetryMs while nothing is pending.
  try{await router.run({kind:'conversation',signal,execute:async()=>{}})}
  catch(error){
   if(error?.code!=='LOCAL_MODEL_CAPACITY_UNAVAILABLE')throw error
   keepEvent({event:'start-without-model',message:String(error.message).slice(0,200)})
   loadRetryTimer=setInterval(()=>{
    if(!ready||stopping||pending.size||router.status.state==='ready'){if(router.status.state==='ready')clearInterval(loadRetryTimer);return}
    router.run({kind:'conversation',signal,execute:async()=>{}}).then(()=>{clearInterval(loadRetryTimer);keepEvent({event:'model-loaded-after-wait'})},()=>{})
   },loadRetryMs);loadRetryTimer.unref?.()
  }
  ready=true
  watchTimer=setInterval(watch,watchMs);watchTimer.unref?.()
 }catch(error){await stop();throw error}
 const endpoint=`http://127.0.0.1:${server.address().port}`
 return {endpoint,modelId:AUTO_MODEL_ID,contextTokens:CONTEXT_TOKENS,exited,stop,pause:()=>router.pause(),
  get routingStatus(){return router.status},
  // Re-run the model choice with nothing pending (stream mode began or ended), so the swap happens
  // now rather than on the owner's next message. Never interrupts a request in flight.
  refreshRoute(){
   if(!ready||stopping||pending.size)return Promise.resolve(false)
   return router.run({kind:'conversation',signal,execute:async()=>{}}).then(()=>true,()=>false)
  },
  get recentTimings(){return recentTimings.map(record=>({...record}))},
  get recentEvents(){return recentEvents.map(record=>({...record}))},
  get pendingRequestCount(){return pending.size},
  get environment(){return {NORI_GPT_OSS_ENABLED:'1',NORI_GPT_OSS_URL:endpoint,NORI_GPT_OSS_SERVER_MODEL:AUTO_MODEL_ID,NORI_GPT_OSS_CONTEXT_TOKENS:String(CONTEXT_TOKENS)}},
  get status(){return {service:'nori-automatic-local-text',endpoint,modelId:AUTO_MODEL_ID,activeModelProfile:router.status.modelId,
   trainedByNori:false,sonCheckpoint:false,automaticRouting:true}}}
}
module.exports={AUTO_MODEL_ID,timingRecord,validatePayload,fitOutputBudget,classifyTextTask,nativeCompatiblePayload,startAutomaticTextService}
