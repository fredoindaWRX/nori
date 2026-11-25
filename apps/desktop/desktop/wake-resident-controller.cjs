const {runBackgroundWakeSupervisor}=require('./background-wake-supervisor.cjs')

// Control plane for a user-visible resident listener; does not install/start it.
function createWakeResidentController({root,runSupervisor=runBackgroundWakeSupervisor,launchApp,onState=()=>{}}={}){
  let state='paused',owner,running,serial=Promise.resolve(),failure
  const setState=value=>{state=value;onState(value)}
  const enqueue=operation=>{
    const result=serial.then(operation)
    serial=result.catch(()=>{})
    return result
  }
  return {
    status:()=>({state,failed:!!failure}),
    resume:()=>enqueue(async()=>{
      if(state==='failed')throw Error('Failed wake listener requires diagnosis before restarting')
      if(running)return false
      owner=new AbortController()
      setState('starting')
      running=Promise.resolve().then(()=>runSupervisor({root,signal:owner.signal,launchApp,
        onState:value=>{if(!owner.signal.aborted)setState(value)}}))
        .then(result=>{if(result?.stopped!==true)throw Error('Wake listener stop not confirmed');return result})
        .catch(error=>{failure=error;setState('failed');return {failed:true}})
      return true // Start requested, not speech readiness acknowledgement.
    }),
    pause:()=>enqueue(async()=>{
      if(!running)return state==='paused'
      owner.abort()
      const result=await running
      running=undefined;owner=undefined
      if(result.failed)throw failure
      setState('paused')
      return true
    }),
  }
}
module.exports={createWakeResidentController}
