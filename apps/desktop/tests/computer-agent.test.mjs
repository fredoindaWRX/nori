// Nori using apps like Claude does (Wil, 2026-11-14): look (screenshot + controls), act once, look again.
import test from 'node:test'
import assert from 'node:assert/strict'
import {requestsComputerControl,requestsAppTask,runComputerTask,runAppTask,toHostCall} from '../bridge/computer-agent.mjs'

test('routes: explicit computer tasks and app tasks are recognised; plain chat and plain "open" are not',()=>{
  assert.equal(requestsComputerControl('Use my computer to type hello in the selected editor'),true)
  assert.equal(requestsComputerControl('Computer task: fill the selected field'),true)
  assert.equal(requestsComputerControl('Use my computerized assistant'),false)
  assert.deepEqual(requestsAppTask('create me a movie scene in filmcraft'),{appId:'filmcraft'})
  assert.deepEqual(requestsAppTask('use PhotoCraft to brighten the photo'),{appId:'photocraft'})
  assert.equal(requestsAppTask('open filmcraft'),null)
  assert.equal(requestsAppTask('tell me about cars'),null)
})

test('proposals become strict host calls in window pixels', ()=>{
  const ctx={snapshotId:'s1',scale:0.5,windowHandle:9,elements:[{id:'e1',name:'Title',controlType:'Edit'}]}
  assert.deepEqual(toHostCall({action:'click',x:100,y:50},ctx).slice(0,2),['click',{windowHandle:9,x:200,y:100}])
  assert.deepEqual(toHostCall({action:'set_text',elementId:'e1',text:'Hi'},ctx).slice(0,2),['set_text',{snapshotId:'s1',elementId:'e1',text:'Hi'}])
  assert.deepEqual(toHostCall({action:'scroll',x:10,y:10,notches:-99},ctx)[1].notches,-20)
  assert.throws(()=>toHostCall({action:'invoke',elementId:'invented'},ctx),/unobserved/)
  assert.throws(()=>toHostCall({action:'click',x:-5,y:1},ctx),/outside/)
})

function fakeHost({fail=false}={}){
  const calls=[]
  let snapshots=0
  const hostCall=async(operation,args)=>{
    calls.push({operation,args})
    if(operation==='status')return {active:true,sessionId:'s',title:'FilmCraft'}
    if(operation==='capture')return {windowHandle:9,mimeType:'image/png',data:'x',windowWidth:1000,windowHeight:800,scale:0.5}
    if(operation==='inspect')return {snapshotId:'snap-'+(++snapshots),windowHandle:9,elements:[{id:'new',name:'New project',controlType:'Button',canInvoke:true}]}
    if(operation==='request_own_window')return {active:true}
    return {completed:!fail}
  }
  return {calls,hostCall}
}

test('the loop looks before every action, acts once per step, and stops on done', async()=>{
  const {calls,hostCall}=fakeHost()
  const plans=[{action:'invoke',elementId:'new',thought:'start a project'},{action:'click',x:50,y:60,thought:'pick the timeline'},{action:'type_text',text:'Scene 1'},{action:'done',thought:'scene created'}]
  const seen=[]
  const planner=async input=>{seen.push(input);return plans.shift()}
  let text=''
  for await(const part of runComputerTask('make a scene',{hostCall,planner,settleMs:0}))text+=part
  const ops=calls.map(c=>c.operation).filter(o=>o!=='status')
  assert.deepEqual(ops,['capture','inspect','invoke','capture','inspect','click','capture','inspect','type_text','capture','inspect'])
  assert.deepEqual(calls.find(c=>c.operation==='click').args,{windowHandle:9,x:100,y:120})
  assert.equal(seen[1].history.length,1,'each step sees what was already done')
  assert.match(text,/Done after 3 actions: scene created/)
})

test('no grant, a denied action, or a blocked planner all stop without guessing', async()=>{
  const collect=async(options,goal='make a scene')=>{for await(const ignored of runComputerTask(goal,{settleMs:0,...options}))void ignored}
  await assert.rejects(collect({hostCall:async()=>({active:false}),planner:async()=>{throw Error('must not plan')}}),/choose a window/i)
  await assert.rejects(collect({...fakeHost({fail:true}),planner:async()=>({action:'click',x:1,y:1})}),/denied|verified/)
  await assert.rejects(collect({...fakeHost(),planner:async()=>({action:'blocked',thought:'export needs a licence'})}),/Stopped: export needs a licence/)
  await assert.rejects(collect({...fakeHost(),planner:async()=>({action:'wait'}),maxSteps:2}),/Stopped after 2 steps/)
})

test('her own tab: she opens the app, Wil approves once, then she works it', async()=>{
  const {calls,hostCall}=fakeHost()
  const launch=async id=>JSON.stringify({launched:true,app_id:id,pid:4242,app_dir:'C:\\Nori\\integrations\\artcraft\\apps\\filmcraft'})
  let text=''
  for await(const part of runAppTask('create me a movie scene in filmcraft',{appId:'filmcraft',hostCall,launch,planner:async()=>({action:'done',thought:'ok'})}))text+=part
  const request=calls.find(c=>c.operation==='request_own_window')
  assert.equal(request.args.processId,4242)
  assert.match(request.args.appDir,/artcraft\\apps\\filmcraft$/)
  assert.match(text,/Opening filmcraft[\s\S]*Asking you to allow[\s\S]*Done/)
  const refused=async()=>{for await(const ignored of runAppTask('x in filmcraft',{appId:'filmcraft',launch,hostCall:async op=>op==='request_own_window'?{active:false}:{active:true}}))void ignored}
  await assert.rejects(refused(),/did not allow/)
})
