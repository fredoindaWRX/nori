const test=require('node:test')
const assert=require('node:assert/strict')
const {startWakeResidentHost}=require('../desktop/wake-resident-host.cjs')
test('resident host starts paused and joins cleanup before quitting',async()=>{
  const listeners={},calls=[];let menu,finish
  const app={on:(name,fn)=>{listeners[name]=fn},whenReady:async()=>{},quit:()=>calls.push('quit')}
  class Tray{
    setToolTip(){} setContextMenu(value){menu=value}
    isDestroyed(){return false}destroy(){calls.push('tray-destroy')}
  }
  const host=await startWakeResidentHost({app,Tray,Menu:{buildFromTemplate:value=>value},
    reportError:error=>{throw error},createController:()=>({status:()=>({state:'paused',failed:false}),
      resume:async()=>{calls.push('capture-start');return true},
      pause:()=>new Promise(resolve=>{finish=resolve})})})
  assert.equal(menu[2].enabled,true)
  assert.deepEqual(calls,[])
  listeners['before-quit']({preventDefault:()=>calls.push('prevent-quit')})
  assert.deepEqual(calls,['prevent-quit'])
  finish(true);assert.equal(await host.stop(),true)
  assert.deepEqual(calls,['prevent-quit','tray-destroy','quit'])
})

test('resident refuses to quit when microphone cleanup is not confirmed',async()=>{
  const calls=[],errors=[]
  const app={on:()=>{},whenReady:async()=>{},quit:()=>calls.push('quit')}
  class Tray{
    setToolTip(){} setContextMenu(){} isDestroyed(){return false}
    destroy(){calls.push('destroy')}
  }
  const host=await startWakeResidentHost({app,Tray,Menu:{buildFromTemplate:value=>value},
    reportError:error=>errors.push(error),createController:()=>({
      status:()=>({state:'paused',failed:false}),pause:async()=>false})})
  assert.equal(await host.stop(),false)
  assert.deepEqual(calls,[])
  assert.equal(errors.length,1)
  assert.match(errors[0].message,/cleanup not confirmed/)
})

test('owned qualification can request listening after tray is ready',async()=>{
  const states=[],calls=[]
  const app={on:()=>{},whenReady:async()=>{},quit:()=>{}}
  class Tray{setToolTip(){} setContextMenu(){} isDestroyed(){return false} destroy(){}}
  const host=await startWakeResidentHost({app,Tray,Menu:{buildFromTemplate:value=>value},
    startListening:true,onState:value=>states.push(value),reportError:error=>{throw error},
    createController:({onState})=>({status:()=>({state:'paused',failed:false}),
      resume:async()=>{calls.push('resume');onState('listening');return true},pause:async()=>true})})
  assert.deepEqual(calls,['resume'])
  assert.deepEqual(states,['listening'])
  assert.equal(await host.stop(),true)
})
test('cleanup reporter failure preserves stop result and permits confirmed retry',async()=>{
  let attempts=0,quit=0
  const app={on(){},whenReady:async()=>{},quit(){quit++}}
  class Tray{setToolTip(){} setContextMenu(){} isDestroyed(){return false} destroy(){}}
  const host=await startWakeResidentHost({app,Tray,Menu:{buildFromTemplate:value=>value},
    reportError(){throw Error('notification unavailable')},createController:()=>({
      status:()=>({state:'paused',failed:false}),pause:async()=>++attempts>1})})
  assert.equal(await host.stop(),false)
  assert.equal(quit,0)
  assert.equal(await host.stop(),true)
  assert.equal(quit,1)
})
