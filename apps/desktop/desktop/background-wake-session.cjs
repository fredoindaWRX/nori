const {createBackgroundWakeController}=require('./background-wake-controller.cjs')
const {startWakeTranscriber}=require('./wake-transcriber.cjs')
const {startStreamingMicrophone}=require('./streaming-microphone.cjs')

// Explicitly started session; no autostart, registry writes or cloud services.
async function runBackgroundWakeSession({root,launchApp,signal,onListening=()=>{},
  capture,startMicrophone=startStreamingMicrophone,startTranscriber=startWakeTranscriber}={}){
  if(typeof launchApp!=='function')throw Error('Owned app activation adapter required')
  const owner=new AbortController()
  let userCancelled=false,microphone
  const abort=()=>{
    userCancelled=true;owner.abort()
    if(microphone)void microphone.stop().catch(()=>{})
    if(worker)void worker.stop().catch(()=>{})
  }
  if(signal?.aborted)throw Error('Background wake cancelled before startup')
  signal?.addEventListener('abort',abort,{once:true})
  let worker,capturing,audio,stopping
  const take=async()=>{
    capturing=capture(root,{duration:2000,signal:owner.signal})
    const result=await capturing
    if(result.ownedHelperExited!==true||!Buffer.isBuffer(result.pcm))throw Error('Microphone exit not confirmed')
    return result
  }
  const release=()=>{
    if(stopping)return stopping
    stopping=(async()=>{
      owner.abort()
      let captureError
      if(capturing){
        try{await capturing}catch(error){if(error.ownedHelperExited!==true)captureError=Error('Microphone cancellation exit not confirmed')}
      }
      let microphoneError
      if(microphone){try{if(await microphone.stop()!==true)throw Error('Streaming microphone exit not confirmed')}
        catch(error){microphoneError=error}}
      if(worker&&await worker.stop()!==true)throw Error('Wake worker stop not confirmed')
      if(microphoneError)throw microphoneError
      if(captureError)throw captureError
      return true
    })()
    return stopping
  }
  const controller=createBackgroundWakeController({
    startCapture:async()=>{
      if(capture)audio=await take()
      else microphone=await startMicrophone(root)
      if(userCancelled)throw Error('Background wake startup cancelled')
      return true
    },stopCapture:release,launchApp,
  })
  try{
    // Claim capture before loading the recognizer; a busy foreground app needs
    // no repeated model loads while the supervisor waits for ownership.
    await controller.enable()
    worker=await startTranscriber(root)
    if(owner.signal.aborted)return {cancelled:true,wakeDetected:false}
    onListening() // Both microphone and warm local recognizer acknowledged ready.
    while(controller.state()==='listening'&&!owner.signal.aborted){
      audio=audio||(microphone?{pcm:await microphone.nextWindow({advanceBytes:32000,windowBytes:96000})}:await take())
      let text
      try{text=await worker.transcribe(audio.pcm)}finally{audio.pcm.fill(0);audio=null}
      if(owner.signal.aborted)break
      if(await controller.transcript(text))return {wakeDetected:true,appLaunchAcknowledged:true}
    }
    return {cancelled:true,wakeDetected:false}
  }catch(error){
    if(userCancelled)return {cancelled:true,wakeDetected:false}
    if(error.code==='NORI_MICROPHONE_YIELDED')return {foregroundRequested:true,wakeDetected:false}
    throw error
  }finally{
    signal?.removeEventListener('abort',abort)
    audio?.pcm.fill(0)
    await release()
  }
}
module.exports={runBackgroundWakeSession}
