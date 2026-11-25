const test=require('node:test')
const assert=require('node:assert/strict')
const {runBackgroundWakeSession}=require('../desktop/background-wake-session.cjs')
test('joined loop releases real-adapter contracts before one app activation',async()=>{
  const calls=[],buffers=[];let count=0
  const result=await runBackgroundWakeSession({root:'synthetic',
    capture:async()=>{calls.push('capture-exited');const pcm=Buffer.from([1,2]);buffers.push(pcm);return {pcm,ownedHelperExited:true}},
    startTranscriber:async()=>({transcribe:async()=>{calls.push('recognize');return ++count===2?'Hey Nori!':'unrelated words'},
      stop:async()=>{calls.push('recognizer-exited');return true}}),
    launchApp:async()=>{calls.push('app');return true}})
  assert.deepEqual(result,{wakeDetected:true,appLaunchAcknowledged:true})
  assert.deepEqual(calls,['capture-exited','recognize','capture-exited','recognize','recognizer-exited','app'])
  assert.ok(buffers.every(buffer=>buffer.every(byte=>byte===0)))
})
test('cancelled capture requires owned exit before reporting cancelled',async()=>{
  const controller=new AbortController();let opened
  const waiting=new Promise(done=>{opened=done})
  const session=runBackgroundWakeSession({root:'synthetic',signal:controller.signal,
    capture:(_root,{signal})=>new Promise((_done,reject)=>{
      signal.addEventListener('abort',()=>reject(Object.assign(Error('cancelled'),{ownedHelperExited:true})),{once:true});opened()}),
    startTranscriber:async()=>({stop:async()=>true}),launchApp:async()=>{throw Error('must not launch')}})
  await waiting;controller.abort()
  assert.deepEqual(await session,{cancelled:true,wakeDetected:false})
})
test('unconfirmed capture termination cannot launch app or report safe cancellation',async()=>{
  let launched=false,stopped=false
  await assert.rejects(runBackgroundWakeSession({root:'synthetic',
    capture:async()=>{throw Error('unknown capture state')},startTranscriber:async()=>({stop:async()=>{stopped=true;return true}}),
    launchApp:async()=>{launched=true;return true}}),/exit not confirmed/)
  assert.equal(launched,false)
  assert.equal(stopped,false) // Capture failed before any recognizer was started.
})

test('continuous wake releases stream and recognizer before selected app activation',async()=>{
  const calls=[],pcm=Buffer.from([1,2,3,4])
  const result=await runBackgroundWakeSession({root:'synthetic',
    startMicrophone:async()=>({nextWindow:async options=>{
      assert.deepEqual(options,{advanceBytes:32000,windowBytes:96000})
      calls.push('window');return pcm},stop:async()=>{calls.push('stream-stopped');return true}}),
    startTranscriber:async()=>({transcribe:async()=>{calls.push('recognize');return 'Hey Nori'},
      stop:async()=>{calls.push('recognizer-stopped');return true}}),
    launchApp:async()=>{calls.push('app');assert.ok(pcm.every(byte=>byte===0));return true}})
  assert.equal(result.wakeDetected,true)
  assert.deepEqual(calls,['window','recognize','stream-stopped','recognizer-stopped','app'])
})

test('continuous unconfirmed stream stop blocks activation and still stops recognition',async()=>{
  let launched=false,recognizerStopped=false
  await assert.rejects(runBackgroundWakeSession({root:'synthetic',
    startMicrophone:async()=>({nextWindow:async()=>Buffer.from([1,2]),stop:async()=>false}),
    startTranscriber:async()=>({transcribe:async()=> 'Hey Nori',stop:async()=>{recognizerStopped=true;return true}}),
    launchApp:async()=>{launched=true;return true}}),/microphone exit not confirmed/)
  assert.equal(launched,false)
  assert.equal(recognizerStopped,true)
})

test('manual foreground handoff is not a spoken wake and cleans both owners',async()=>{
  const calls=[]
  const result=await runBackgroundWakeSession({root:'synthetic',
    startMicrophone:async()=>({nextWindow:async()=>{throw Object.assign(Error('yield'),{code:'NORI_MICROPHONE_YIELDED'})},
      stop:async()=>{calls.push('capture-stop');return true}}),
    startTranscriber:async()=>({stop:async()=>{calls.push('recognizer-stop');return true}}),
    launchApp:async()=>{throw Error('Manual launch must not trigger duplicate activation')}})
  assert.deepEqual(result,{foregroundRequested:true,wakeDetected:false})
  assert.deepEqual(calls,['capture-stop','recognizer-stop'])
})
