const test=require('node:test')
const assert=require('node:assert/strict')
const path=require('node:path')
const {acquireForegroundMicrophoneLease}=require('../desktop/foreground-microphone-lease.cjs')
const {startStreamingMicrophone}=require('../desktop/streaming-microphone.cjs')
const {runBackgroundWakeSession}=require('../desktop/background-wake-session.cjs')
const {runBackgroundWakeSupervisor}=require('../desktop/background-wake-supervisor.cjs')
test('actual Windows foreground lease excludes background helper until owned release',async()=>{
  const root=path.resolve(__dirname,'../../..')
  let lost=0
  const first=await acquireForegroundMicrophoneLease(root,{onLost:()=>lost++})
  try{
    await assert.rejects(acquireForegroundMicrophoneLease(root),/reservation unavailable/)
    await assert.rejects(startStreamingMicrophone(root),{code:'NORI_MICROPHONE_BUSY'})
  }finally{assert.equal(await first.stop(),true)}
  assert.equal(lost,0)
  const next=await acquireForegroundMicrophoneLease(root)
  assert.equal(await next.stop(),true)
})

test('manual foreground request makes real background capture yield its mutex',async()=>{
  const root=path.resolve(__dirname,'../../..')
  const microphone=await startStreamingMicrophone(root)
  let foreground
  try{
    // Read/clear one bounded physical window; never save or print audio.
    const pcm=await microphone.nextWindow({advanceBytes:32000,windowBytes:96000})
    pcm.fill(0)
    foreground=await acquireForegroundMicrophoneLease(root)
    assert.equal(await microphone.stop(),true)
    await assert.rejects(startStreamingMicrophone(root),{code:'NORI_MICROPHONE_BUSY'})
  }finally{
    await microphone.stop()
    if(foreground)assert.equal(await foreground.stop(),true)
  }
})

test('actual supervisor waits for foreground release then captures and stops owned session',async()=>{
  const root=path.resolve(__dirname,'../../..'),owner=new AbortController(),states=[]
  const foreground=await acquireForegroundMicrophoneLease(root)
  let released,attempts=0,recognizerStarts=0,samples=0
  const deadline=setTimeout(()=>owner.abort(),10000)
  try{
    const result=await runBackgroundWakeSupervisor({root,signal:owner.signal,retryMs:100,
      launchApp:async()=>{throw Error('This hardware test must not launch an app')},
      onState:state=>{
        states.push(state)
        if(state==='waiting-foreground'&&!released)released=foreground.stop()
      },
      runSession:async options=>{
        attempts++
        if(released)assert.equal(await released,true)
        return runBackgroundWakeSession({...options,startTranscriber:async()=>{
          recognizerStarts++
          return {transcribe:async pcm=>{samples+=pcm.length;owner.abort();return ''},stop:async()=>true}
        }})
      }})
    assert.deepEqual(result,{stopped:true})
    assert.equal(attempts,2)
    assert.equal(recognizerStarts,1) // No model work while foreground owns capture.
    assert.ok(samples>0)
    assert.deepEqual(states,['arming','waiting-foreground','arming','listening','stopped'])
  }finally{clearTimeout(deadline);owner.abort();await foreground.stop()}
})
