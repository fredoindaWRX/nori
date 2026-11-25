import test from 'node:test'
import assert from 'node:assert/strict'
import {keepEarthClockCurrent} from '../src/scene/earth-clock.ts'
test('Earth lighting clock resynchronizes with wall time and cleans up',()=>{
  const clock={currentTime:0,shouldAnimate:false,multiplier:99}
  let time=100,tick,listener,removed,cancelled,redraws=0
  const stop=keepEarthClockCurrent(clock,()=>time,()=>redraws++,{
    addEventListener:(name,callback)=>{assert.equal(name,'visibilitychange');listener=callback},
    removeEventListener:(name,callback)=>{removed=callback===listener&&name==='visibilitychange'},
  },(callback,ms)=>{assert.equal(ms,60000);tick=callback;return 7},timer=>{cancelled=timer===7})
  assert.deepEqual(clock,{currentTime:100,shouldAnimate:true,multiplier:1})
  time=500;tick();assert.equal(clock.currentTime,500)
  time=10000;listener();assert.equal(clock.currentTime,10000)
  assert.equal(redraws,3)
  stop();assert.equal(removed,true);assert.equal(cancelled,true)
})
