'use strict'
const test=require('node:test')
const assert=require('node:assert/strict')
const {startVideoModelOwner}=require('../desktop/video-model-lease.cjs')
test('a real logical-service exit remains fatal while model capacity is unavailable',async()=>{
 let exit
 const service={routingStatus:{state:'unavailable'},exited:new Promise(resolve=>{exit=resolve}),
  stop:async()=>exit({unexpected:false}),
  pause:async()=>({resume:async()=>{throw Object.assign(Error('capacity unavailable'),{code:'LOCAL_MODEL_CAPACITY_UNAVAILABLE'})}})}
 const owner=await startVideoModelOwner(async()=>service)
 const lease=await owner.acquire()
 await assert.rejects(lease.release(),/capacity unavailable/)
 assert.equal(owner.state,'unavailable')
 exit({unexpected:true});assert.equal((await owner.exited).unexpected,true)
 assert.equal(owner.state,'failed');await owner.stop()
})
function fixture(){
  const children=[]
  const factory=async()=>{
    let exit;const exited=new Promise(resolve=>{exit=resolve})
    const service={exited,stops:0,stop:async()=>{service.stops++;exit({code:0})},crash:()=>exit({code:1})}
    children.push(service);return service
  }
  return {children,factory}
}
test('intentional pause preserves desktop owner, rejects overlap, restores a new owned model',async()=>{
  const f=fixture(),owner=await startVideoModelOwner(f.factory)
  let exited=false;owner.exited.then(()=>{exited=true})
  const lease=await owner.acquire()
  assert.equal(owner.state,'paused');assert.equal(f.children[0].stops,1)
  assert.equal(exited,false)
  await assert.rejects(owner.acquire(),/busy/)
  await lease.release();assert.equal(owner.state,'ready');assert.equal(f.children.length,2)
  await assert.rejects(lease.release(),/does not belong/)
  await owner.stop();assert.equal((await owner.exited).unexpected,false)
})
test('failed and cancelled video work restores the language model before propagating failure',async()=>{
  const f=fixture(),owner=await startVideoModelOwner(f.factory)
  const error=Object.assign(Error('Cancelled'),{name:'AbortError'})
  await assert.rejects(owner.withLease(async()=>{throw error}),e=>e===error)
  assert.equal(owner.state,'ready');assert.equal(f.children.length,2)
  await owner.stop()
})
test('desktop shutdown during a paused lease does not restart the model',async()=>{
  const f=fixture(),owner=await startVideoModelOwner(f.factory),lease=await owner.acquire()
  await owner.stop();await lease.release()
  assert.equal(owner.state,'stopped');assert.equal(f.children.length,1)
})
test('unexpected running-model exit remains an owner failure',async()=>{
  const f=fixture(),owner=await startVideoModelOwner(f.factory)
  f.children[0].crash()
  assert.equal((await owner.exited).unexpected,true);assert.equal(owner.state,'failed')
  await owner.stop()
})
test('restore failure retains the render failure and reports owner failure',async()=>{
  const f=fixture();let calls=0
  const owner=await startVideoModelOwner(async()=>{if(calls++)throw Error('Restart failed');return f.factory()})
  await assert.rejects(owner.withLease(async()=>{throw Error('Render failed')}),e=>e instanceof AggregateError&&e.errors.length===2)
  assert.equal(owner.state,'failed');assert.equal((await owner.exited).unexpected,true)
  await owner.stop()
})
test('shutdown waits for an in-flight restore and disposes the replacement instead of adopting it',async()=>{
  const f=fixture();let resume,calls=0
  const owner=await startVideoModelOwner(async()=>{if(calls++)await new Promise(resolve=>{resume=resolve});return f.factory()})
  const lease=await owner.acquire(),restoring=lease.release()
  const stopping=owner.stop();assert.equal(owner.stop(),stopping)
  resume();await Promise.all([restoring,stopping])
  assert.equal(owner.state,'stopped');assert.equal(f.children.length,2)
  assert.equal(f.children[1].stops,1)
})
