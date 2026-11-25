// Computer control session (Wil, 2026-11-14: "Approve once per task").
// One approval covers the task inside the approved program; a small floor still asks first.
import test from 'node:test'
import assert from 'node:assert/strict'
import {createComputerControlSession,RISKY_LABEL} from '../bridge/computer-control-session.mjs'

const editor={id:'1.2.3',name:'Synthetic editor',controlType:'Edit',password:false,canSetText:true,canInvoke:true,rect:[10,10,200,30]}
const deleteButton={id:'1.2.4',name:'Delete layer',controlType:'Button',password:false,canInvoke:true,rect:[300,10,80,30]}
const capture={mimeType:'image/png',data:'iVBORw0KGgo=',windowWidth:800,windowHeight:600,scale:1}
function fake({confirm=async()=>true,windows=[]}={}){
  const calls=[],confirmations=[]
  const session=createComputerControlSession({windowHandle:123,processId:456,approved:true,title:'PhotoCraft',
    execute:async request=>{calls.push(request)
      if(request.operation==='inspect')return {elements:[editor,deleteButton]}
      if(request.operation==='capture')return capture
      if(request.operation==='process_windows')return {windows:[{windowHandle:123,processId:456,title:'PhotoCraft'},...windows]}
      return {completed:true}},
    confirmAction:async request=>{confirmations.push(request);return confirm(request)}})
  return {session,calls,confirmations}
}

test('one approval covers ordinary work: no per-action prompts for typing, clicking, scrolling', async()=>{
  const {session,calls,confirmations}=fake()
  await assert.rejects(session.call('set_text',{snapshotId:'invented',elementId:editor.id,text:'Hello'}),/Inspect/)
  const observed=await session.call('inspect')
  assert.equal((await session.call('set_text',{snapshotId:observed.snapshotId,elementId:editor.id,text:'Hello'})).completed,true)
  await assert.rejects(session.call('click',{x:20,y:20}),/Capture the window/)
  await session.call('capture')
  await session.call('click',{x:20,y:20})
  await session.call('scroll',{x:400,y:300,notches:-3})
  await session.call('drag',{x:10,y:10,x2:100,y2:120})
  await session.call('type_text',{text:'Nori City'})
  await session.call('key',{keys:'enter'})
  assert.equal(confirmations.length,0)
  assert.deepEqual(calls.find(c=>c.operation==='set_text'),{operation:'set_text',windowHandle:123,processId:456,elementId:editor.id,expectedName:editor.name,expectedControlType:editor.controlType,text:'Hello'})
  assert.deepEqual(calls.find(c=>c.operation==='click'),{operation:'click',windowHandle:123,processId:456,x:20,y:20})
})

test('the floor still asks: delete/send controls, clicks on them, and taking the real keyboard', async()=>{
  const {session,confirmations}=fake({confirm:async()=>false})
  const observed=await session.call('inspect')
  await assert.rejects(session.call('invoke',{snapshotId:observed.snapshotId,elementId:deleteButton.id}),/did not approve/)
  await session.call('inspect'); await session.call('capture')
  await assert.rejects(session.call('click',{x:320,y:20}),/did not approve/)
  await assert.rejects(session.call('key',{keys:'ctrl+s',foreground:true}),/did not approve/)
  assert.equal(confirmations.length,3)
  assert.ok(RISKY_LABEL.test('Replace existing file') && RISKY_LABEL.test('Send') && !RISKY_LABEL.test('Save'))
})

test('only the approved program: its dialogs are allowed, other windows are not', async()=>{
  const {session}=fake({windows:[{windowHandle:777,processId:456,title:'Export settings'}]})
  assert.deepEqual((await session.call('windows')).windows.map(w=>w.windowHandle),[123,777])
  await session.call('capture',{windowHandle:777})
  await assert.rejects(session.call('capture',{windowHandle:999}),/does not belong/)
})

test('bounds: points inside the captured window, no unknown arguments, passwords refused, stop ends it', async()=>{
  const {session}=fake()
  await session.call('capture')
  await assert.rejects(session.call('click',{x:5000,y:20}),/outside/)
  await assert.rejects(session.call('click',{x:1,y:1,command:'rm'}),/Unexpected/)
  await assert.rejects(session.call('shell',{command:'anything'}),/Unsupported/)
  await assert.rejects(session.call('key',{keys:'ctrl+s; calc'}),/Invalid key/)
  await assert.rejects(session.call('scroll',{x:1,y:1,notches:0}),/notches/)
  const unsafe=createComputerControlSession({windowHandle:1,processId:2,approved:true,
    execute:async()=>({elements:[{...editor,password:true}]}),confirmAction:async()=>true})
  await assert.rejects(unsafe.call('inspect'),/Unsafe/)
  assert.throws(()=>createComputerControlSession({approved:false}),/user-approved/)
  session.stop()
  await assert.rejects(session.call('capture'),/stopped/)
})

test('observations expire and the task has a time limit', async()=>{
  let time=0
  const session=createComputerControlSession({windowHandle:1,processId:2,approved:true,now:()=>time,minutes:30,
    execute:async request=>request.operation==='inspect'?{elements:[editor]}:{completed:true},confirmAction:async()=>true})
  const first=await session.call('inspect')
  time=61_000
  await assert.rejects(session.call('invoke',{snapshotId:first.snapshotId,elementId:editor.id}),/Inspect/)
  time=31*60_000
  await assert.rejects(session.call('inspect'),/expired/)
})
