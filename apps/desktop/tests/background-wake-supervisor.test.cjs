const test=require('node:test')
const assert=require('node:assert/strict')
const {runBackgroundWakeSupervisor}=require('../desktop/background-wake-supervisor.cjs')
test('busy foreground waits, rearms after release, and cancellation stops without activation',async()=>{
  const owner=new AbortController(),states=[];let attempts=0,launches=0
  const result=await runBackgroundWakeSupervisor({root:'synthetic',signal:owner.signal,retryMs:10,
    onState:state=>states.push(state),launchApp:async()=>{launches++;return true},
    runSession:async()=>{
      if(++attempts===1)throw Object.assign(Error('busy'),{code:'NORI_MICROPHONE_BUSY'})
      if(attempts===2)return {foregroundRequested:true,wakeDetected:false}
      owner.abort();return {cancelled:true,wakeDetected:false}
    }})
  assert.deepEqual(result,{stopped:true})
  assert.equal(attempts,3);assert.equal(launches,0)
  assert.deepEqual(states,['arming','waiting-foreground','arming','waiting-foreground','arming','stopped'])
})
test('unqualified capture failure is terminal, not an unattended retry',async()=>{
  const owner=new AbortController();let attempts=0
  await assert.rejects(runBackgroundWakeSupervisor({signal:owner.signal,retryMs:10,
    runSession:async()=>{attempts++;throw Error('unknown helper termination')}}),/unknown helper termination/)
  assert.equal(attempts,1)
})
