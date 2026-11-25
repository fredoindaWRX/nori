const test=require('node:test')
const assert=require('node:assert/strict')
const {createComputerHost}=require('../desktop/computer-host.cjs')

test('only renderer can grant a listed window; host denies cancelled consent',async()=>{
  let created=0
  const host=createComputerHost({owns:event=>event==='owner',getWindow:()=>null,
    dialog:{showMessageBox:async()=>({response:1})},load:async()=>[
      {createComputerControlSession:()=>{created++;throw Error('should not create')}},
      {executeWindowsComputerAction:async()=>({windows:[{windowHandle:1,processId:2,title:'Synthetic'}]})},
    ]})
  await assert.rejects(host.start('stranger',{windowHandle:1,processId:2}),/cannot start/)
  await assert.rejects(host.start('owner',{windowHandle:9,processId:2}),/no longer/)
  assert.deepEqual(await host.start('owner',{windowHandle:1,processId:2}),{active:false})
  await assert.rejects(host.call('invoke',{}),/Choose a window/)
  assert.equal(created,0)
})

test('host action dialog and stop remain outside the model connection',async()=>{
  const dialogs=[]
  let stopped=false,confirm
  const host=createComputerHost({owns:event=>event==='owner',getWindow:()=>null,
    dialog:{showMessageBox:async(_window,args)=>{dialogs.push(args);return {response:0}}},load:async()=>[
      {createComputerControlSession:options=>{confirm=options.confirmAction;return {id:'s',expiresAt:Date.now()+10000,
        stop:()=>{stopped=true},call:async()=>({completed:true})}}},
      {executeWindowsComputerAction:async()=>({windows:[{windowHandle:1,processId:2,title:'Synthetic'}]})},
    ]})
  assert.equal((await host.start('owner',{windowHandle:1,processId:2})).active,true)
  assert.equal(await confirm({operation:'set_text',element:{name:'Field'},text:'Hello'}),true)
  assert.equal(dialogs.length,2)
  assert.match(dialogs[1].detail,/Hello/)
  host.stop();assert.equal(stopped,true)
  assert.equal(host.status().active,false)
})

test('trusted Electron host publishes live application and window capabilities',async()=>{
  const host=createComputerHost({owns:event=>event==='owner',getWindow:()=>null,dialog:{showMessageBox:async()=>({response:1})},load:async()=>[
    {createComputerControlSession:()=>{throw Error('not needed') }},
    {executeWindowsComputerAction:async()=>({windows:[
      {windowHandle:1001,processId:42,title:'Notes',executable:'notepad.exe'},
      {windowHandle:1002,processId:42,title:'Notes - second view',executable:'notepad.exe'},
    ]})},
  ]})
  await assert.rejects(host.capabilities('stranger'),/untrusted/i)
  const snapshot=await host.capabilities('owner')
  assert.equal(snapshot.contract,'nori.host-capability.v1')
  assert.equal(snapshot.source,'trusted-electron-host')
  assert.equal(snapshot.capabilities.some(item=>item.kind==='window'&&item.metadata.windowHandle===1001),true)
  assert.equal(snapshot.capabilities.filter(item=>item.kind==='application').length,1)
})
