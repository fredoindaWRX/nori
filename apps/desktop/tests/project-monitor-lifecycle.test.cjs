const {test}=require('node:test')
const assert=require('node:assert/strict')
const {resolve}=require('node:path')
const {connect}=require('node:net')
const {once}=require('node:events')
const {startProjectMonitor}=require('../desktop/project-monitor.cjs')
const root=resolve(__dirname,'../../..')
test('desktop wires owned monitor startup and joint shutdown with explicit isolated probe opt-in',()=>{
  const source=require('node:fs').readFileSync(resolve(__dirname,'../desktop/main.cjs'),'utf8')
  assert.match(source,/!PROBE_SESSION \|\| process.argv.includes\('--monitor-check'\)/)
  assert.match(source,/port: PROBE_SESSION \? 0 : 8790/)
  assert.match(source,/projectMonitorOwner.abort\(\)/)
  assert.match(source,/const shutdownDesktop = onceDesktopShutdown\(async \(\) => \{/)
  assert.match(source,/const stopImportedStack = async \(\) => \{[\s\S]*?await gptOssCore\?\.stop\(\)[\s\S]*?await gptOssService\?\.stop\(\)/)
  assert.match(source,/Promise\.allSettled\(\[\s*nativeService\?\.stop\(\),\s*stopImportedStack\(\),\s*projectMonitor\?\.stop\(\),\s*remoteControl\?\.stop\(\),\s*drainDesktopWriters\(\[bridge, council, ollama, legacyBus, comfy, handInput\]\),\s*foregroundMicrophoneLease\?\.stop\(\)\]\)/)
  assert.match(source,/event.preventDefault\(\)\s*void shutdownDesktop\(\)/)
})
test('owned dashboard binds loopback, refuses competing ownership and stops idempotently',async()=>{
  const owner=await startProjectMonitor({root,port:0})
  try {
    assert.equal((await fetch(owner.endpoint+'/project/')).status,200)
    await assert.rejects(startProjectMonitor({root,port:Number(new URL(owner.endpoint).port)}),{code:'EADDRINUSE'})
    assert.equal((await fetch(owner.endpoint+'/project/')).status,200)
  }finally{await owner.stop();await owner.stop()}
  await assert.rejects(fetch(owner.endpoint+'/project/'))
})
test('cancelled startup creates no owned monitor',async()=>{
  const controller=new AbortController();controller.abort()
  await assert.rejects(startProjectMonitor({root,port:0,signal:controller.signal}),/cancelled/)
})
test('owner cancellation closes its established listener',async()=>{
  const controller=new AbortController()
  const owner=await startProjectMonitor({root,port:0,signal:controller.signal})
  controller.abort();await owner.stop()
  await assert.rejects(fetch(owner.endpoint+'/project/'))
})
test('an idle connected client cannot hold the owned application open on shutdown',async()=>{
  const owner=await startProjectMonitor({root,port:0})
  const socket=connect({host:'127.0.0.1',port:Number(new URL(owner.endpoint).port)})
  try {
    await once(socket,'connect')
    const closed=once(socket,'close')
    await owner.stop();await closed
    assert.equal(socket.destroyed,true)
  }finally{socket.destroy();await owner.stop()}
})
