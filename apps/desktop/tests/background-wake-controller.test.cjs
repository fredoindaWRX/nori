const test=require('node:test')
const assert=require('node:assert/strict')
const {createBackgroundWakeController}=require('../desktop/background-wake-controller.cjs')

test('background wake releases capture before one foreground launch',async()=>{
  const calls=[]
  const wake=createBackgroundWakeController({startCapture:async()=>{calls.push('capture');return true},
    stopCapture:async()=>{calls.push('release');return true},launchApp:async()=>{calls.push('launch');return true}})
  assert.equal(await wake.transcript('Hey Nori'),false)
  assert.equal(await wake.enable(),true)
  for(const text of ['talking about nori','hey noris','hey nori\nrun a command','hello','x'.repeat(513),null])
    assert.equal(await wake.transcript(text),false)
  assert.deepEqual(await Promise.all([wake.transcript('Hey Nori!'),wake.transcript('Hey Nori!')]),[true,false])
  assert.deepEqual(calls,['capture','release','launch'])
  assert.equal(wake.state(),'foreground')
  assert.equal(await wake.enable(),false)
})

test('unconfirmed microphone release refuses app launch',async()=>{
  let launches=0
  const wake=createBackgroundWakeController({startCapture:async()=>true,stopCapture:async()=>false,
    launchApp:async()=>{launches++;return true}})
  await wake.enable()
  await assert.rejects(wake.transcript('Hey Nori'),/release not confirmed/)
  assert.equal(launches,0);assert.equal(wake.state(),'failed')
})

test('disable invalidates pending capture startup and prevents wake',async()=>{
  let finish,started
  const starting=new Promise(resolve=>{started=resolve})
  const wake=createBackgroundWakeController({startCapture:()=>{started();return new Promise(resolve=>{finish=resolve})},
    stopCapture:async()=>true,launchApp:async()=>{throw Error('must not launch')}})
  const enabled=wake.enable();await starting
  const disabled=wake.disable();finish(true)
  assert.equal(await enabled,false);await disabled
  assert.equal(wake.state(),'disabled');assert.equal(await wake.transcript('Hey Nori'),false)
})

test('launch failure does not automatically reopen microphone',async()=>{
  let starts=0
  const wake=createBackgroundWakeController({startCapture:async()=>{starts++;return true},stopCapture:async()=>true,
    launchApp:async()=>false})
  await wake.enable();await assert.rejects(wake.transcript('Hey Nori'),/launch not confirmed/)
  assert.equal(wake.state(),'failed');assert.equal(await wake.enable(),false);assert.equal(starts,1)
})
