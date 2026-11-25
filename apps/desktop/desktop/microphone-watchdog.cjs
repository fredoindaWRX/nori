// Detect missing sample delivery, not quiet audio: zero-valued PCM is activity.
function createMicrophoneWatchdog(onStall,{timeoutMs=5000}={}){
  if(typeof onStall!=='function'||!Number.isInteger(timeoutMs)||timeoutMs<10||timeoutMs>30000)
    throw Error('Invalid microphone watchdog')
  let timer,stopped=false
  const touch=()=>{
    if(stopped)return
    clearTimeout(timer)
    timer=setTimeout(()=>{stopped=true;onStall()},timeoutMs)
  }
  return {touch,stop(){stopped=true;clearTimeout(timer)}}
}
module.exports={createMicrophoneWatchdog}
