const {runBackgroundWakeSession}=require('./background-wake-session.cjs')
const {activateSelectedWakeApp}=require('./selected-wake-app.cjs')
function waitForRetry(signal,ms){
  if(signal.aborted)return Promise.resolve()
  return new Promise(resolve=>{
    const finish=()=>{clearTimeout(timer);signal.removeEventListener('abort',finish);resolve()}
    const timer=setTimeout(finish,ms)
    signal.addEventListener('abort',finish,{once:true})
  })
}
// Explicit owner controls lifetime. Only proven ownership contention is retried;
// arbitrary capture/recognition/cleanup failures stop rather than restart blindly.
async function runBackgroundWakeSupervisor({root,signal,runSession=runBackgroundWakeSession,
  launchApp=()=>activateSelectedWakeApp(root),retryMs=2000,onState=()=>{}}={}){
  if(!signal||typeof signal.addEventListener!=='function'||!Number.isInteger(retryMs)||retryMs<10||retryMs>30000)
    throw Error('Owned supervisor signal and bounded retry required')
  while(!signal.aborted){
    onState('arming')
    try{
      const result=await runSession({root,signal,launchApp,onListening:()=>onState('listening')})
      if(signal.aborted||result.cancelled)break
      if(!result.foregroundRequested&&!result.wakeDetected)throw Error('Unexpected wake session result')
      onState('waiting-foreground')
    }catch(error){
      if(error.code!=='NORI_MICROPHONE_BUSY'){onState('failed');throw error}
      onState('waiting-foreground')
    }
    await waitForRetry(signal,retryMs)
  }
  onState('stopped')
  return {stopped:true}
}
module.exports={runBackgroundWakeSupervisor}
