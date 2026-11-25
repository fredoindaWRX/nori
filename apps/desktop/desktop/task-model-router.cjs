'use strict'

// Internal lifecycle coordination only. A model route never grants tool access.
// Production integration must supply verified capacity and an owned engine factory.
const {importedModelProfile}=require('./imported-model-profile.cjs')
// Automatic routing preserves the owner's minimum context without inventing larger profiles.
const MIN_CONTEXT_TOKENS=65536
const contextFor=profile=>importedModelProfile(profile).defaultContext
// Owner exception 2026-11-17: a profile whose native context is below 64K states its own floor
// (minimumContext). Every other profile keeps the 64K floor.
const floorFor=profile=>importedModelProfile(profile).minimumContext??MIN_CONTEXT_TOKENS
// Largest first; a smaller qualified context is used only when the larger one does not fit.
const contextsFor=profile=>{const p=importedModelProfile(profile);return [p.defaultContext,...(p.fallbackContexts??[]).map(item=>item.context)].filter(context=>context>=floorFor(profile))}
const CONTEXT_TOKENS=contextFor('qwen3.5-9b')
// Retain the registered middle tier, but it is ineligible until a >=64K profile is qualified.
const SECONDARY='qwen3-24b-freedom'
const secondaryAllowed=(route,failed,promptTokens,outputTokens)=>!route.streaming&&route.worker!=='vision'&&failed!==SECONDARY&&failed!=='qwen3.5-9b'&&contextsFor(SECONDARY).some(context=>context>=promptTokens+outputTokens)
function capacityError(message){return Object.assign(new Error(message),{code:'LOCAL_MODEL_CAPACITY_UNAVAILABLE'})}
const ROUTES=Object.freeze({
// Owner, 2026-11-17: her two models are the Qwen3 14B (first choice for text, 32K) and the abliterated
// 9B (fallback at 64K or more, all vision, and any prompt over the 14B's budget). The 35B and 24B
// profiles stay registered but are no longer routed automatically.
 conversation:Object.freeze({worker:'conversation',preferred:'qwen3-14b'}),
 research:Object.freeze({worker:'research',preferred:'qwen3-14b'}),
 vision:Object.freeze({worker:'vision',preferred:'qwen3.5-9b'}),
 coding:Object.freeze({worker:'aider',preferred:'qwen3-14b'}),
 reasoning:Object.freeze({worker:'conversation',preferred:'qwen3-14b'}),
 'code-review':Object.freeze({worker:'aider',preferred:'qwen3-14b'}),
})

function textTaskRoute(kind){
 if(typeof kind!=='string'||!Object.hasOwn(ROUTES,kind))throw new TypeError('Unsupported host text task kind')
 return ROUTES[kind]
}

function createTaskModelRouter({startModel,canLoad,drainTimeoutMs=15000,clock=Date.now,preferSecondary=()=>false,onEvent=()=>{}}={}){
 if(typeof startModel!=='function'||typeof canLoad!=='function')throw new TypeError('Owned model factory and verified capacity check required')
 if(typeof preferSecondary!=='function')throw new TypeError('Stream-mode preference must be a function')
 if(!Number.isInteger(drainTimeoutMs)||drainTimeoutMs<1||drainTimeoutMs>60000)throw new RangeError('Invalid model-router shutdown deadline')
 let current=null,state='idle',tail=Promise.resolve(),closed=false,activeAbort=null,stopping=null,paused=null
 // Why the loaded model was chosen and when; reported to Nori's self-status, never a control input.
 let lastRoute=null
 // Revalidate once on entering stream mode, without pretending owned reclaim proves fit.
 let streamModeActive=false
 // After the preferred model was measured not to fit, do not unload a working model to retry it
 // on every turn (each retry reloads the fallback); the cheap capacity check still runs each turn.
 const UPGRADE_RETRY_MS=5*60_000,upgradeFailedAt=new Map()
 const upgradeRecentlyFailed=profile=>clock()-(upgradeFailedAt.get(profile)??-Infinity)<UPGRADE_RETRY_MS
 const shutdown=new AbortController()
 // R84: the step the router is in and since when (read by the text service's watchdog), and
 // events for the local model log: numbers, error messages and the engine's last error lines.
 let activity={phase:'idle',since:clock(),profile:null}
 const setPhase=(phase,profile=null)=>{activity={phase,since:clock(),profile}}
 const emit=event=>{try{onEvent({at:new Date(clock()).toISOString(),...event})}catch{}}
 const tailText=text=>typeof text==='string'&&text.trim()?text.slice(-3000):undefined
 const errorText=error=>String(error?.message??error).slice(0,300)
 // Engines this router stopped on purpose; any other exit is reported as unexpected.
 const releasing=new WeakSet()
 const stopCurrent=async()=>{
  const prior=current
  if(!prior)return
  state='switching';releasing.add(prior);setPhase('stopping',prior.modelId)
  emit({event:'model-stop',profile:prior.modelId,contextTokens:prior.contextTokens})
  await prior.stop()
  if(current===prior)current=null
 }
 const observe=model=>{
  model.exited.then(result=>{
   if(!releasing.has(model))emit({event:'model-exited',profile:model.modelId,contextTokens:model.contextTokens,
    code:result?.code??null,signal:result?.signal??null,stderrTail:tailText(result?.stderrTail)})
   if(current===model&&state==='ready')state='unavailable'
  },()=>{if(current===model&&state==='ready')state='unavailable'})
 }
 // A running copy of the profile is kept at its context unless the prompt needs more and a
 // larger qualified context now fits; then the copy is reloaded at that context.
 const fitting=async(profile,from,signal,needed=MIN_CONTEXT_TOKENS,compact=false)=>{
  needed=Math.max(floorFor(profile),needed)
  const running=Boolean(from&&from===current&&state==='ready'&&from.modelId===profile)
  const contexts=contextsFor(profile)
  if(!compact&&running&&contexts.includes(from.contextTokens)&&from.contextTokens>=needed)return from.contextTokens
  // Streamed text uses the smallest qualified context covering the prompt, leaving GPU room
  // for OBS. A larger running copy may therefore be replaced by the qualified 64K copy.
  for(const contextTokens of compact?[...contexts].sort((a,b)=>a-b):contexts)
   if(contextTokens>=needed){
    if(running&&contextTokens===from.contextTokens)return contextTokens
    if(await canLoad(profile,{current:from,contextTokens,signal}))return contextTokens
   }
  // A running copy too small for this prompt is not a fit either; the caller falls further down.
  return null
 }
 const load=async(profile,signal,contextTokens=contextFor(profile))=>{
  signal.throwIfAborted()
  if(!contextsFor(profile).includes(contextTokens))throw capacityError('The model has no qualified context meeting its minimum')
  setPhase('loading',profile);const loadStarted=clock()
  emit({event:'load-start',profile,contextTokens})
  let model
  try{model=await startModel({profile,contextTokens,signal})}catch(error){
   emit({event:'load-failed',profile,contextTokens,ms:clock()-loadStarted,canceled:signal.aborted,message:errorText(error),stderrTail:tailText(error?.stderrTail)})
   throw error
  }
  try{
   if(!model||typeof model.stop!=='function'||typeof model.exited?.then!=='function')throw Error('Invalid owned model lifecycle')
   signal.throwIfAborted()
   if(model.modelId!==profile||model.contextTokens!==contextTokens)throw Error('Owned model identity or context does not match the route')
   current=model;state='ready';observe(model);emit({event:'load-ready',profile,contextTokens,ms:clock()-loadStarted});return model
  }catch(error){if(typeof model?.stop==='function')await model.stop();throw error}
 }
 const modeRoute=async(route,signal)=>{
  const active=Boolean(await preferSecondary())
  signal.throwIfAborted()
  if(active&&!streamModeActive&&current){
   // Cold thresholds cannot be applied to an already loaded engine's remaining RAM.
   // Release once, then measure actual free resources before choosing the 35B or 9B.
   await stopCurrent();signal.throwIfAborted()
  }
  streamModeActive=active
  return active&&route.worker!=='vision'?{...route,streaming:true}:route
 }
 const choose=async(route,signal,promptTokens=0,outputTokens=4096)=>{
  signal.throwIfAborted()
  // A prompt longer than the preferred model's context goes to the long-context 9B.
  if(route.preferred!=='qwen3.5-9b'&&promptTokens>contextFor(route.preferred)-outputTokens)route={...route,preferred:'qwen3.5-9b'}
  // OBS keeps the 35B when it fits; otherwise choose a qualified 9B context, never sub-64K.
  const chosen=route.streaming?'stream_mode':'preferred',unavailable=route.streaming?'stream_mode_capacity_unavailable':'preferred_capacity_unavailable'
  let contextTokens=await fitting(route.preferred,current,signal,promptTokens+outputTokens,route.streaming)
  if(contextTokens){upgradeFailedAt.delete(route.preferred);return {profile:route.preferred,contextTokens,reason:chosen}}
  if(!current)upgradeFailedAt.set(route.preferred,clock())
  if(current&&current.modelId!==route.preferred&&canLoad.recheckAfterUnload===true&&!upgradeRecentlyFailed(route.preferred)){
   await stopCurrent();signal.throwIfAborted()
   if((contextTokens=await fitting(route.preferred,null,signal,promptTokens+outputTokens,route.streaming))){upgradeFailedAt.delete(route.preferred);return {profile:route.preferred,contextTokens,reason:route.streaming?'stream_mode':'preferred_after_owned_release'}}
   upgradeFailedAt.set(route.preferred,clock())
  }
  if(secondaryAllowed(route,route.preferred,promptTokens,outputTokens)&&(contextTokens=await fitting(SECONDARY,current,signal,promptTokens+outputTokens)))return {profile:SECONDARY,contextTokens,reason:unavailable}
  if(route.preferred!=='qwen3.5-9b'&&(contextTokens=await fitting('qwen3.5-9b',current,signal,promptTokens+outputTokens,route.streaming)))return {profile:'qwen3.5-9b',contextTokens,reason:unavailable}
  if(!route.streaming&&route.worker!=='vision'&&state==='ready'&&current&&contextsFor(current.modelId).includes(current.contextTokens)&&current.contextTokens>=Math.max(floorFor(current.modelId),promptTokens+outputTokens)&&await canLoad(current.modelId,{current,contextTokens:current.contextTokens,signal}))return {profile:current.modelId,contextTokens:current.contextTokens,reason:'preferred_capacity_unavailable_reuse_current'}
  throw capacityError('No verified local text model fits the required context')
 }
 return {
  get activity(){return Object.freeze({...activity})},
  get status(){return Object.freeze({state,modelId:current?.modelId??null,contextTokens:current?current.contextTokens:CONTEXT_TOKENS,
   reason:current&&lastRoute?.engine===current?lastRoute.reason:null,since:current&&lastRoute?.engine===current?lastRoute.at:null})},
  run({kind,execute,signal,promptTokens=0,outputTokens=4096}={}){
   const route=textTaskRoute(kind)
   if(typeof execute!=='function')throw new TypeError('A host-owned task callback is required')
   if(!Number.isSafeInteger(outputTokens)||outputTokens<1||outputTokens>8192)throw new RangeError('Invalid output-token reservation')
   if(!Number.isSafeInteger(promptTokens)||promptTokens<0||promptTokens>Number.MAX_SAFE_INTEGER-outputTokens)throw new RangeError('Invalid prompt-token estimate')
   if(closed)return Promise.reject(Error('Model router stopped'))
   const task=tail.then(async()=>{
    if(closed)throw Error('Model router stopped')
    signal?.throwIfAborted()
    const local=new AbortController();activeAbort=local
    const joined=signal?AbortSignal.any([signal,local.signal]):local.signal
    let effectiveRoute=route
    // Every fallback must cover both the owner context floor and this turn's output budget.
    const fallbackFrom=async(failed,signal)=>{
     let contextTokens
     if(secondaryAllowed(effectiveRoute,failed,promptTokens,outputTokens)&&(contextTokens=await fitting(SECONDARY,null,signal,promptTokens+outputTokens)))return {profile:SECONDARY,contextTokens}
     if(failed!=='qwen3.5-9b'&&(contextTokens=await fitting('qwen3.5-9b',null,signal,promptTokens+outputTokens,effectiveRoute.streaming)))return {profile:'qwen3.5-9b',contextTokens}
     return null
    }
    try{
     setPhase('choosing')
     effectiveRoute=await modeRoute(route,joined)
     const selected=await choose(effectiveRoute,joined,promptTokens,outputTokens)
     if(!current||state!=='ready'||current.modelId!==selected.profile||current.contextTokens!==selected.contextTokens){
      await stopCurrent()
      if(canLoad.recheckAfterUnload===true){
       const recheck=await fitting(selected.profile,null,joined,promptTokens+outputTokens,effectiveRoute.streaming)
       if(recheck)selected.contextTokens=recheck
       else{
        upgradeFailedAt.set(selected.profile,clock())
        const lower=await fallbackFrom(selected.profile,joined)
        if(!lower)throw capacityError('Local capacity changed before model startup')
        Object.assign(selected,lower,{reason:'preferred_capacity_changed'})
       }
      }
      try{await load(selected.profile,joined,selected.contextTokens)}catch(error){
       // A failed large-model launch may recover to the checked everyday model.
       // Cancellation never starts a replacement model or repeats the task.
       joined.throwIfAborted()
       const lower=await fallbackFrom(selected.profile,joined)
       if(!lower)throw error
       Object.assign(selected,lower,{reason:'preferred_startup_failed'})
       try{await load(selected.profile,joined,selected.contextTokens)}catch(secondError){
        joined.throwIfAborted()
        const last=selected.profile==='qwen3.5-9b'?null:await fitting('qwen3.5-9b',null,joined,promptTokens+outputTokens,effectiveRoute.streaming)
        if(!last)throw secondError
        Object.assign(selected,{profile:'qwen3.5-9b',contextTokens:last})
        await load(selected.profile,joined,last)
       }
      }
     }
     joined.throwIfAborted()
     const model=current
     // Keep the reason of the load that put this model in place; reuse turns do not overwrite it.
     if(lastRoute?.engine!==model){lastRoute={engine:model,modelId:selected.profile,reason:selected.reason,at:clock()}
      emit({event:'route',profile:selected.profile,contextTokens:selected.contextTokens,reason:selected.reason})}
     // Wait for callback quiescence before accepting the next task. This avoids
     // switching under a canceled worker that has not actually stopped yet.
     setPhase('executing',selected.profile)
     const value=await execute({service:model,worker:route.worker,modelId:selected.profile,
      contextTokens:selected.contextTokens,reason:selected.reason,signal:joined})
     joined.throwIfAborted()
     if(state!=='ready'||current!==model)throw Error('Owned model stopped before task completion')
     return value
    }finally{activeAbort=null;setPhase('idle');if(!current&&!closed)state='idle'}
   })
   tail=task.catch(()=>{})
   if(!signal)return task
   let canceled
   const interrupted=new Promise((_,reject)=>{
    canceled=()=>reject(signal.reason??Error('Model request canceled'))
    if(signal.aborted)canceled();else signal.addEventListener('abort',canceled,{once:true})
   })
   return Promise.race([task,interrupted]).finally(()=>signal.removeEventListener('abort',canceled))
  },
  async pause(){
   if(closed||paused)throw Error('Model router is already paused or stopped')
   let resume,ready,failed
   const barrier=new Promise(resolve=>{resume=resolve})
   const established=new Promise((resolve,reject)=>{ready=resolve;failed=reject})
   const reservation={resume};paused=reservation
   const transition=tail.then(async()=>{
    shutdown.signal.throwIfAborted()
    await stopCurrent();state='paused';setPhase('paused');emit({event:'paused'});ready()
    await barrier
    emit({event:'resumed'})
    if(closed)return
    // Restore the current stream policy after media work, preserving the context floor.
    const selected=await choose(await modeRoute(ROUTES.conversation,shutdown.signal),shutdown.signal)
    await load(selected.profile,shutdown.signal,selected.contextTokens)
    lastRoute={engine:current,modelId:selected.profile,reason:selected.reason,at:clock()};setPhase('idle')
   }).catch(error=>{setPhase('idle');emit({event:'resume-failed',message:errorText(error)});failed(error);if(!closed)state='unavailable';throw error})
    .finally(()=>{if(paused===reservation)paused=null})
   tail=transition.catch(()=>{})
   await established
   return Object.freeze({resume:()=>{resume();return transition}})
  },
  stop(){
   if(stopping)return stopping
   closed=true;shutdown.abort(Error('Model router stopped'));activeAbort?.abort(Error('Model router stopped'));paused?.resume()
   stopping=(async()=>{
    let timer
    try{
     await Promise.race([tail,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Owned task did not quiesce before the shutdown deadline')),drainTimeoutMs)})])
     await stopCurrent();state='stopped'
    }catch(error){
     // Keep the router closed and report failure. Never claim a callback that
     // ignored cancellation has stopped, or start another task alongside it.
     try{await stopCurrent()}finally{state='failed'}
     throw error
    }finally{clearTimeout(timer)}
   })()
   return stopping
  },
 }
}
module.exports={SECONDARY,CONTEXT_TOKENS,MIN_CONTEXT_TOKENS,textTaskRoute,createTaskModelRouter}
