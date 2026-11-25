'use strict'
const test=require('node:test'),assert=require('node:assert/strict')
const {createStreamModeDetector}=require('../desktop/stream-mode.cjs')
test('stopping during a probe suppresses its late state change and refresh callback',async()=>{
 let release,signal
 const changes=[]
 const detector=createStreamModeDetector({dataRoot:'synthetic',settings:()=>({enabled:true}),onChange:value=>changes.push(value),
  probe:abortSignal=>{signal=abortSignal;return new Promise(resolve=>{release=resolve})}})
 const pending=detector.tick()
 detector.stop()
 release(true)
 await pending
 assert.equal(signal?.aborted,true)
 assert.equal(detector.isActive(),false)
 assert.deepEqual(changes,[])
})
test('OBS presence respects owner settings and only reports actual transitions',async()=>{
 let obs=false,enabled=true
 const changes=[]
 const detector=createStreamModeDetector({dataRoot:'synthetic',probe:async()=>obs,settings:()=>({enabled}),onChange:value=>changes.push(value)})
 try{
  assert.equal(await detector.tick(),false)
  obs=true;assert.equal(await detector.tick(),true)
  await detector.tick();assert.deepEqual(changes,[true])
  enabled=false;assert.equal(await detector.tick(),false)
  assert.deepEqual(changes,[true,false])
 }finally{detector.stop()}
})
test('concurrent detector polls share one probe and probe failures deactivate mode',async()=>{
 let release,calls=0,fail=false
 const detector=createStreamModeDetector({dataRoot:'synthetic',settings:()=>({enabled:true}),probe:()=>{calls++;if(fail)throw Error('Synthetic unavailable probe');return new Promise(resolve=>{release=resolve})}})
 try{
  const first=detector.tick(),second=detector.tick()
  assert.equal(calls,1);release(true)
  assert.equal(await first,true);assert.equal(await second,true)
  fail=true;assert.equal(await detector.tick(),false)
 }finally{detector.stop()}
})
