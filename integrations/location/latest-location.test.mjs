import test from 'node:test'
import assert from 'node:assert/strict'
import {createLatestLocation} from './latest-location.mjs'
const sample={_type:'location',lat:42,lon:-71,acc:12,tst:1000}
test('sharing defaults off and pause clears the last location',()=>{
  const store=createLatestLocation({now:()=>1000000})
  assert.throws(()=>store.accept(sample),/paused/)
  store.enable();store.accept(sample);store.pause()
  assert.deepEqual(store.read(),{enabled:false,location:null,stale:true})
})
test('latest replaces earlier data and drops extra identifying fields',()=>{
  const store=createLatestLocation({now:()=>1010000});store.enable()
  store.accept({...sample,device:'private phone',address:'private address'})
  store.accept({...sample,tst:1005,lat:43})
  const state=store.read();assert.equal(state.location.latitude,43)
  assert.equal(state.location.device,undefined);assert.equal(state.history,undefined)
  state.location.latitude=1;assert.equal(store.read().location.latitude,43)
  assert.equal(store.accept(sample),false)
})
test('invalid, future and old samples never replace the latest',()=>{
  const store=createLatestLocation({now:()=>2000000});store.enable()
  for(const change of [{lat:NaN},{lon:181},{acc:-1},{tst:3000},{tst:1}])assert.throws(()=>store.accept({...sample,...change}))
  assert.equal(store.read().location,null)
})
test('staleness is based on measurement time, not read time',()=>{
  let time=1000000;const store=createLatestLocation({now:()=>time});store.enable();store.accept(sample)
  time+=900001;assert.equal(store.read().stale,true)
})
