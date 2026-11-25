const test=require('node:test')
const assert=require('node:assert/strict')
const {createWakeResidentTray}=require('../desktop/wake-resident-tray.cjs')
function fixture(pause){
  let menu,tip,destroyed=false,quit=false,error=false
  const result=createWakeResidentTray({
    tray:{setToolTip:value=>{tip=value},setContextMenu:value=>{menu=value},destroy:()=>{destroyed=true}},
    Menu:{buildFromTemplate:value=>value},
    controller:{status:()=>({state:'paused',failed:false}),resume:async()=>true,pause},
    onQuit:()=>{quit=true},onError:()=>{error=true},
  })
  return {result,read:()=>({menu,tip,destroyed,quit,error})}
}
test('tray labels paused state and waits for cleanup before stopping',async()=>{
  let finish
  const f=fixture(()=>new Promise(resolve=>{finish=resolve}))
  assert.match(f.read().tip,/Paused/)
  const stopping=f.read().menu.at(-1).click()
  assert.equal(f.read().quit,false)
  finish(true);await stopping
  assert.equal(f.read().destroyed,true);assert.equal(f.read().quit,true)
})
test('unconfirmed cleanup keeps controls visible and does not quit',async()=>{
  const f=fixture(async()=>{throw Error('helper still alive')})
  await f.read().menu.at(-1).click()
  assert.equal(f.read().quit,false);assert.equal(f.read().destroyed,false);assert.equal(f.read().error,true)
})
test('tray exposes explicit verified Windows sign-in toggle',async()=>{
  let enabled=false,menu
  createWakeResidentTray({
    tray:{setToolTip(){},setContextMenu:value=>{menu=value},destroy(){}},
    Menu:{buildFromTemplate:value=>value},
    controller:{status:()=>({state:'paused',failed:false}),resume:async()=>true,pause:async()=>true},
    loginSettings:{isEnabled:()=>enabled,setEnabled:async value=>{enabled=value;return true}},
    onQuit(){},onError:error=>{throw error},
  })
  const toggle=menu.find(item=>item.label==='Start wake listener with Windows')
  assert.equal(toggle.checked,false)
  await toggle.click()
  assert.equal(enabled,true)
})
test('unreadable startup state leaves pause and stop controls available',async()=>{
  let menu,errors=0,quit=false
  createWakeResidentTray({
    tray:{setToolTip(){},setContextMenu:value=>{menu=value},destroy(){}},
    Menu:{buildFromTemplate:value=>value},
    controller:{status:()=>({state:'paused',failed:false}),resume:async()=>true,pause:async()=>true},
    loginSettings:{isEnabled(){throw Error('registry denied')},setEnabled(){throw Error('must not mutate')}},
    onQuit(){quit=true},onError(){errors++},
  })
  const startup=menu.find(item=>item.label==='Windows startup setting unavailable')
  assert.equal(startup.enabled,false)
  assert.equal(startup.checked,false)
  assert.equal(errors,1)
  await menu.at(-1).click()
  assert.equal(quit,true)
})
test('throwing error reporter cannot strand the tray on a startup read failure',()=>{
  let menu
  createWakeResidentTray({
    tray:{setToolTip(){},setContextMenu:value=>{menu=value},destroy(){}},
    Menu:{buildFromTemplate:value=>value},
    controller:{status:()=>({state:'paused',failed:false}),resume:async()=>true,pause:async()=>true},
    loginSettings:{isEnabled(){throw Error('unreadable')}},
    onQuit(){},onError(){throw Error('notification failed')},
  })
  assert.ok(menu.some(item=>item.label==='Stop background wake'))
  assert.equal(menu.find(item=>item.label==='Windows startup setting unavailable').enabled,false)
})
