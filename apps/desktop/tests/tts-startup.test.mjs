import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import vm from 'node:vm'
import {EventEmitter} from 'node:events'
import {PassThrough} from 'node:stream'
import {createInterface} from 'node:readline'

// Exercise the actual recovered bridge startup implementation with no Python,
// microphone, model weights or audio devices. Only its spawned child is fake.
const source=readFileSync(new URL('../bridge/server.mjs',import.meta.url),'utf8')
const implementation=source.slice(source.indexOf('let localTtsReady = null'),source.indexOf('async function renderLocalTts'))
function fakeChild(delayedExit=false){
  const child=new EventEmitter()
  child.stdout=new PassThrough();child.stderr=new PassThrough();child.stdin=new PassThrough()
  child.pid=123;child.killed=false;child.kill=()=>{child.killed=true;if(!delayedExit)child.emit('exit')}
  return child
}
function fixture(delayedExit=false){
  const child=fakeChild(delayedExit), replacement=fakeChild()
  const spawns=[]
  const context=vm.createContext({spawn:(command,args,options)=>{spawns.push({command,args:Array.from(args),options});return spawns.length===1?child:replacement},
    createInterface,Buffer,process:{env:{}},localTtsAvailable:()=>true,LOCAL_VOICE_PATHS:{python:'fake-python',args:['-I','-B','fake-launcher','--kokoro','worker','model','voices']},
    setTimeout:(fn)=>setTimeout(fn,15),clearTimeout})
  vm.runInContext(implementation,context)
  return {child,replacement,spawns,start:()=>vm.runInContext('startLocalTts()',context),status:()=>JSON.parse(vm.runInContext('JSON.stringify(localTtsStatus())',context)),cleanup:()=>{for(const item of [child,replacement]){item.emit('exit');item.stdout.destroy();item.stderr.destroy();item.stdin.destroy()}}}
}

test('late exit from failed worker does not invalidate its ready replacement',async()=>{
  const f=fixture(true)
  try{
    const first=f.start();f.child.stdin.emit('error',new Error('first worker failed'))
    await assert.rejects(first,/first worker failed/)
    const second=f.start();f.replacement.stdout.write('{"ready":true}\n');await second
    f.child.emit('exit')
    assert.equal(f.start(),second,'Old exit cleared the replacement readiness cache')
  }finally{f.cleanup()}
})
test('silent speech startup times out and stops its own worker',async()=>{
  const f=fixture()
  try{await assert.rejects(f.start(),/startup timed out/);assert.equal(f.child.killed,true)}finally{f.cleanup()}
})
test('speech readiness cancels startup deadline and drains stderr',async()=>{
  const f=fixture()
  try{
    const ready=f.start();f.child.stdout.write('{"ready":true}\n')
    assert.equal(await ready,f.child)
    await new Promise(resolve=>setTimeout(resolve,25))
    assert.equal(f.child.killed,false);assert.equal(f.child.stderr.readableFlowing,true)
  }finally{f.cleanup()}
})
test('speech stdin failure rejects startup instead of becoming uncaught EPIPE',async()=>{
  const f=fixture()
  try{
    const ready=f.start();f.child.stdin.emit('error',new Error('fake EPIPE'))
    await assert.rejects(ready,/fake EPIPE/);assert.equal(f.child.killed,true)
  }finally{f.cleanup()}
})
test('actual speech startup pins isolated no-bytecode args,offline flags and hidden worker',async()=>{
  const f=fixture()
  try{
    const ready=f.start();f.child.stdout.write('{"ready":true}\n');await ready
    assert.equal(f.spawns[0].command,'fake-python')
    assert.deepEqual(f.spawns[0].args,['-I','-B','fake-launcher','--kokoro','worker','model','voices'])
    assert.equal(f.spawns[0].options.windowsHide,true)
    assert.equal(f.spawns[0].options.env.HF_HUB_OFFLINE,'1')
    assert.equal(f.spawns[0].options.env.TRANSFORMERS_OFFLINE,'1')
    assert.equal(f.spawns[0].options.env.PYTHONDONTWRITEBYTECODE,'1')
  }finally{f.cleanup()}
})
test('speech health separates available files from warmed readiness and clears exited worker',async()=>{
  const f=fixture()
  try{
    assert.deepEqual(f.status(),{available:true,ready:false,workerPid:null,backend:'kokoro-local',cloudFallback:false})
    const ready=f.start()
    assert.equal(f.status().ready,false)
    assert.equal(f.status().workerPid,123)
    f.child.stdout.write('{"ready":true}\n');await ready
    assert.equal(f.status().ready,true)
    f.child.emit('exit')
    assert.equal(f.status().ready,false)
    assert.equal(f.status().workerPid,null)
  }finally{f.cleanup()}
})
