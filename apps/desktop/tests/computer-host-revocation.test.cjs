const test=require('node:test'),assert=require('node:assert/strict')
const {createComputerHost}=require(process.env.NORI_COMPUTER_HOST_AUDIT_MODULE||'../desktop/computer-host.cjs')
const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done});return{promise,resolve}}
const tick=()=>new Promise(resolve=>setImmediate(resolve))
function fixture(stage){
 const gate=deferred(),owner={},target={windowHandle:123,processId:456,title:'Synthetic'},calls={list:0,dialog:0,created:0,stopped:0},sessions=[]
 let window=owner,blocked=true
 const wait=async name=>{if(blocked&&stage===name){await gate.promise;blocked=false}}
 const host=createComputerHost({getWindow:()=>window,owns:event=>event===owner,dialog:{showMessageBox:async()=>{calls.dialog++;await wait('approval');return{response:0}}},load:async()=>{
  await wait('load');return[{createComputerControlSession:async options=>{
   calls.created++;await wait('factory');const session={id:'s'+calls.created,expiresAt:Date.now()+10000,stop(){calls.stopped++},call:async()=>({completed:true})};sessions.push({session,options});return session
  }},{executeWindowsComputerAction:async()=>{calls.list++;await wait('listing');return{windows:[target]}}}]
 }})
 return{host,owner,target,calls,sessions,release:()=>gate.resolve(),changeOwner:()=>{window={}}}
}
for(const stage of ['load','listing','approval','factory'])test(`Stop invalidates startup awaiting ${stage}`,async()=>{
 const f=fixture(stage),startup=f.host.start(f.owner,f.target),rejected=assert.rejects(startup,/stopped|owner changed/i)
 await tick();f.host.stop();f.release();await rejected
 assert.equal(f.host.status().active,false)
 assert.equal(f.calls.created,stage==='factory'?1:0)
 if(stage==='factory')assert.equal(f.calls.stopped,1,'late-created session must be stopped')
 assert.equal((await f.host.start(f.owner,f.target)).active,true,'new explicit approval can recover')
 f.host.stop()
})
test('changed owner cannot approve an old session action or dispatch an old snapshot',async()=>{
 const f=fixture();await f.host.start(f.owner,f.target);const {options}=f.sessions[0]
 f.changeOwner()
 assert.equal(await options.confirmAction({operation:'invoke',element:{name:'Synthetic'}}),false)
 await assert.rejects(options.execute({operation:'invoke',windowHandle:123,processId:456}),/revoked/)
 await assert.rejects(f.host.call('inspect'),/Choose a window/)
 assert.equal(f.calls.dialog,1,'no new action dialog for a revoked owner')
})
test('Stop rejects pending action completion and old approval callback after replacement',async()=>{
 const f=fixture();await f.host.start(f.owner,f.target);const old=f.sessions[0],done=deferred()
 old.session.call=()=>done.promise
 const action=f.host.call('inspect'),rejected=assert.rejects(action,/revoked/)
 f.host.stop();done.resolve({snapshotId:'stale'});await rejected
 await f.host.start(f.owner,f.target)
 assert.equal(await old.options.confirmAction({operation:'invoke',element:{name:'Old'}}),false)
 await assert.rejects(old.options.execute({operation:'invoke'}),/revoked/)
 f.host.stop()
})
test('Stop while computer action approval awaits prevents physical adapter dispatch',async()=>{
 const {createComputerControlSession}=await import('../bridge/computer-control-session.mjs')
 const decision=deferred(),owner={};let dialogs=0,actions=0
 const host=createComputerHost({getWindow:()=>owner,owns:event=>event===owner,dialog:{showMessageBox:async()=>++dialogs===1?{response:0}:decision.promise},load:async()=>[
  {createComputerControlSession},{executeWindowsComputerAction:async request=>{
   if(request.operation==='list_windows')return{windows:[{windowHandle:123,processId:456,title:'Synthetic'}]}
   if(request.operation==='inspect')return{elements:[{id:'e',name:'Delete item',controlType:'Button',password:false,canInvoke:true,canSetText:false}]}
   actions++;return{completed:true}
  }}]})
 // Since 2026-11-14 only risky controls (delete/send/overwrite...) ask; this one does.
 await host.start(owner,{windowHandle:123,processId:456});const snapshot=await host.call('inspect')
 const action=host.call('invoke',{snapshotId:snapshot.snapshotId,elementId:'e'}),rejected=assert.rejects(action,/stopped|revoked|approved/i)
 await tick();host.stop();decision.resolve({response:0});await rejected;assert.equal(actions,0);assert.equal(host.status().active,false)
})
