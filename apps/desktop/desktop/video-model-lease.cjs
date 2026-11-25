'use strict'

/** Own one local model across an intentional GPU pause. No PID discovery/killing. */
async function startVideoModelOwner(startService) {
  if(typeof startService!=='function')throw new TypeError('An owned local model factory is required')
  let service=await startService(),state='ready',closed=false,lease=null,transition=null,stopping=null,pausedResume=null
  let reportExit
  const exited=new Promise(resolve=>{reportExit=resolve})
  const observe=child=>{
    child.exited.then(result=>{
      if(service===child&&(state==='ready'||state==='unavailable')&&!closed){state='failed';reportExit({...result,unexpected:true})}
    },error=>{
      if(service===child&&(state==='ready'||state==='unavailable')&&!closed){state='failed';reportExit({unexpected:true,error})}
    })
  }
  observe(service)
  const release=async token=>{
    if(token!==lease)throw Error('Video model lease does not belong to this request')
    if(transition)await transition
    if(closed)return
    if(state!=='paused')throw Error('Local model is not paused')
    state='restoring'
    transition=(async()=>{
      try{
        const replacement=pausedResume?await pausedResume().then(()=>service):await startService()
        pausedResume=null
        if(closed){await replacement.stop();return}
        if(service!==replacement){service=replacement;observe(service)}state='ready';lease=null
      }catch(error){
        if(!closed&&pausedResume&&error.code==='LOCAL_MODEL_CAPACITY_UNAVAILABLE'&&service.routingStatus?.state==='unavailable'){
          // The logical endpoint is still owned and listening. Resource loss is
          // recoverable on a later request; do not make the desktop quit.
          pausedResume=null;lease=null;state='unavailable'
        }else if(!closed){state='failed';reportExit({unexpected:true,error})}
        throw error
      }
      finally{transition=null}
    })()
    await transition
  }
  return {
    get state(){if(state==='unavailable'&&service.routingStatus?.state==='ready')state='ready';return state},get current(){return service},exited,
    async acquire(){
      if(closed||this.state!=='ready'||lease)throw Error('Local model is busy or unavailable for a video lease')
      const token=Object.freeze({});lease=token;state='pausing'
      transition=(async()=>{
        try{
          if(typeof service.pause==='function'){
            const paused=await service.pause()
            if(typeof paused?.resume!=='function')throw Error('Owned model pause did not provide restoration')
            pausedResume=paused.resume
          }else await service.stop()
          if(!closed)state='paused'
        }
        catch(error){if(!closed){state='failed';reportExit({unexpected:true,error})}throw error}
        finally{transition=null}
      })()
      await transition
      if(closed)throw Error('Desktop stopped during video model pause')
      return Object.freeze({release:()=>release(token)})
    },
    async withLease(work){
      if(typeof work!=='function')throw new TypeError('A video job is required')
      const owned=await this.acquire()
      let result,failure
      try{result=await work()}catch(error){failure=error}
      try{await owned.release()}catch(error){
        if(failure)throw new AggregateError([failure,error],'Video failed and the local model could not be restored')
        throw error
      }
      if(failure)throw failure
      return result
    },
    stop(){
      if(stopping)return stopping
      closed=true;state='stopping'
      stopping=(async()=>{
        const original=service,originalStop=Promise.resolve(service.stop())
        originalStop.catch(()=>{}) // Observe failures while the transition drains.
        if(transition)await transition.catch(()=>{})
        await originalStop
        if(service!==original)await service.stop()
        state='stopped';reportExit({unexpected:false})
      })()
      return stopping
    },
  }
}
module.exports={startVideoModelOwner}
