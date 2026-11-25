import test from 'node:test'
import assert from 'node:assert/strict'
import {EventEmitter} from 'node:events'
import {PassThrough} from 'node:stream'
import {spawn} from 'node:child_process'
import {resolve} from 'node:path'
import {runScreenTextWorker} from '../bridge/screen-text-process.mjs'
function fixture(){
  const child=new EventEmitter();child.pid=123;child.exitCode=null
  child.stdin=new PassThrough();child.stdout=new PassThrough()
  child.kills=0;child.kill=()=>{child.kills++;return true}
  return child
}
const options={root:'fixture',worker:'fixed-worker',image:'image',deadlineMs:1000,cleanupMs:50}
test('aborted input never starts a worker',async()=>{
  const c=new AbortController();c.abort()
  assert.equal(await runScreenTextWorker({...options,signal:c.signal,spawnProcess:()=>{throw Error('must not spawn')}}),null)
})
test('active cancellation waits for owned close, then resolves once without stale output',async()=>{
  const child=fixture(),c=new AbortController();let finished=false
  const result=runScreenTextWorker({...options,signal:c.signal,spawnProcess:()=>child}).then(value=>{finished=true;return value})
  child.stdout.write('stale');c.abort();c.abort()
  await new Promise(resolve=>setImmediate(resolve))
  assert.equal(finished,false);assert.equal(child.kills,1)
  child.stdout.write('more');child.exitCode=1;child.emit('close',1)
  assert.equal(await result,null)
})
test('failure to close is explicit cleanup failure, not a successful cancellation',async()=>{
  const child=fixture()
  await assert.rejects(runScreenTextWorker({...options,deadlineMs:5,cleanupMs:10,spawnProcess:()=>child}),
    error=>error.code==='NORI_OCR_CLEANUP_FAILED')
  assert.equal(child.kills,1)
})
test('successful output waits for close and respects byte bound',async()=>{
  const child=fixture(),result=runScreenTextWorker({...options,spawnProcess:()=>child})
  child.stdout.write('valid');child.exitCode=0;child.emit('close',0)
  assert.equal(await result,'valid')
  const large=fixture(),refused=runScreenTextWorker({...options,spawnProcess:()=>large})
  large.stdout.write('x'.repeat(32769));assert.equal(large.kills,1)
  large.exitCode=1;large.emit('close',1);assert.equal(await refused,null)
})
test('actual Windows cancellation and deadline both drain only their exact fixed worker',{skip:process.platform!=='win32'},async()=>{
  for(const mode of ['abort','deadline']){
    const c=new AbortController();let child
    const value=await runScreenTextWorker({root:resolve(import.meta.dirname,'../../..'),
      worker:resolve(import.meta.dirname,'fixtures/screen-text-wait.ps1'),image:'synthetic',
      signal:c.signal,deadlineMs:mode==='deadline'?100:1000,cleanupMs:2000,
      spawnProcess:(...args)=>{
        child=spawn(...args)
        if(mode==='abort')child.once('spawn',()=>c.abort())
        return child
      }})
    assert.equal(value,null)
    assert.ok(child.pid>0)
    assert.throws(()=>process.kill(child.pid,0),'Exact worker still exists after result resolved')
  }
})
