import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createHomeAssistantClient,homeAssistantConfig,ownerRequested,commandsFor,deviceHubReport,formatDeviceHub} from '../bridge/home-device-hub.mjs'
import {createHomeTools} from '../bridge/home-tools.mjs'
import {homeDomains,bindHomeCall} from '../bridge/home-intent-binding.mjs'

const config={base_url:'http://127.0.0.1:8123',token:'test-only'}
test('shared app tool dispatch binds the owner request and records unverified activation honestly',async()=>{
 const opened=[]
 const tools=createHomeTools({dataRoot:tmpdir(),intentGoal:'open Calculator',transports:{
  appList:async()=>[{name:'Calculator',id:'Calculator.App'}],
  appOpen:async id=>{opened.push(id);return{requested:true,verified:false}},
 }})
 const result=JSON.parse(await tools.call('launch_app',{name:'Calculator'},{callId:'app-test'}))
 assert.deepEqual(opened,['Calculator.App'])
 assert.equal(result.verified,false)
 assert.match(tools.homeLedger.take('app-test').ownerText,/not confirmed/)
})
const entity=(state='off',id='light.office')=>({entity_id:id,state,attributes:{friendly_name:'Office lamp'},last_updated:'2026-11-10T12:00:00Z'})
const services=[{domain:'light',services:{turn_on:{},turn_off:{}}}]
function fixture({settle=true,extra=[],unavailable=false}={}) {
  let changed=false,reads=0; const calls=[]
  const fetcher=async(url,opts)=>{
    calls.push({url,method:opts.method,body:opts.body})
    assert.equal(opts.redirect,'error')
    assert.equal(opts.headers.Authorization,'Bearer test-only')
    if(url.endsWith('/api/services'))return Response.json(services)
    if(url.endsWith('/api/states'))return Response.json([entity(unavailable?'unavailable':'off'),...extra])
    if(opts.method==='POST'){changed=true;return Response.json([])}
    reads++;return Response.json(entity(changed&&settle&&reads>=3?'on':'off'))
  }
  return {calls,client:createHomeAssistantClient({config,fetcher,pause:async()=>{}})}
}
test('owner binding rejects negation, quoted instructions and compound requests',()=>{
  assert.equal(ownerRequested('Please turn on the Office lamp.','turn_on','light.office','Office lamp'),true)
  for(const text of ['Do not turn on the Office lamp','He said turn on Office lamp','turn on Office lamp and turn off kitchen','If I say turn on Office lamp','turn off Office lamp'])
    assert.equal(ownerRequested(text,'turn_on','light.office','Office lamp'),false,text)
})
test('inventory exposes supported commands and no token',async()=>{
  const {client}=fixture();const r=await client.discover()
  assert.deepEqual(r.devices[0].commands,['turn_on','turn_off']);assert.ok(!JSON.stringify(r).includes('test-only'))
})
test('command waits for readback and reports confirmed state',async()=>{
  const {client,calls}=fixture();const r=await client.command('light.office','turn_on','turn on Office lamp')
  assert.equal(r.verified,true);assert.equal(calls.filter(x=>x.method==='POST').length,1)
})
test('accepted action with unchanged state is not verified',async()=>{
  const {client}=fixture({settle:false});const r=await client.command('light.office','turn_on','turn on Office lamp')
  assert.equal(r.verified,false);assert.equal(r.accepted,true)
})
test('unknown target, unavailable target and unsupported command never write',async()=>{
  for(const [id,action,options] of [['light.missing','turn_on',{}],['light.office','turn_on',{unavailable:true}],['light.office','start',{}]]){
    const {client,calls}=fixture(options);assert.equal((await client.command(id,action,'start Office lamp')).success,false)
    assert.equal(calls.some(x=>x.method==='POST'),false)
  }
})
test('duplicate friendly name requires literal entity ID',async()=>{
  const {client,calls}=fixture({extra:[entity('off','light.other')]})
  assert.equal((await client.command('light.office','turn_on','turn on Office lamp')).error,'ambiguous_device_name')
  assert.equal(calls.some(x=>x.method==='POST'),false)
})
test('cameras, sensors and unsupported vacuum actions are read-only',()=>{
  assert.deepEqual(commandsFor({entity_id:'camera.door'},services),[])
  assert.deepEqual(commandsFor({entity_id:'vacuum.bot',attributes:{supported_features:8}},[{domain:'vacuum',services:{stop:{},start:{}}}]),['stop'])
})
test('bad authorization, malformed response and cancellation fail closed',async()=>{
  const bad=createHomeAssistantClient({config,fetcher:async()=>new Response('',{status:401})})
  assert.equal((await bad.discover()).success,false)
  const controller=new AbortController();controller.abort()
  const cancelled=createHomeAssistantClient({config,signal:controller.signal,fetcher:async()=>{throw Error('must not run')}})
  await assert.rejects(cancelled.discover())
})
test('configuration rejects HTTP public servers, userinfo and untrusted enrollment',()=>{
  const root=mkdtempSync(join(tmpdir(),'nori-hub-test-'));mkdirSync(join(root,'integrations'))
  try {for(const c of [{...config,base_url:'http://example.com',trusted:true},{...config,base_url:'https://user:pass@example.com',trusted:true},{...config,trusted:false}]){
    writeFileSync(join(root,'integrations/home_assistant.json'),JSON.stringify(c));assert.equal(homeAssistantConfig(root,'missing'),null)
  }}finally{rmSync(root,{recursive:true})}
})
test('combined report preserves unavailable and cached evidence boundaries',async()=>{
  const root=mkdtempSync(join(tmpdir(),'nori-hub-test-'))
  try{const r=await deviceHubReport({dataRoot:root,hue:async()=> 'Your Hue Bridge has 2 lights.',client:{configured:false,discover:async()=>({success:false,error:'home_assistant_not_configured'})}})
    assert.match(formatDeviceHub(r),/not connected/);assert.match(formatDeviceHub(r),/not proof/)
  }finally{rmSync(root,{recursive:true})}
})
test('model tool dispatch reaches hub and owner-facing ledger',async()=>{
  const {client}=fixture();const root=mkdtempSync(join(tmpdir(),'nori-hub-test-'))
  try{
    assert.ok(homeDomains('show my devices').has('hub'))
    const tools=createHomeTools({dataRoot:root,intentGoal:'turn on light.office',transports:{hubOptions:{client}}})
    const r=JSON.parse(await tools.call('home_device_control',{entity_id:'light.office',command:'turn_on'},{callId:'test'}))
    assert.equal(r.verified,true);assert.match(tools.homeLedger.take('test').ownerText,/Confirmed by Home Assistant/)
  }finally{rmSync(root,{recursive:true})}
})
test('existing TV and Hue tools remain offered',()=>{
  const tools=createHomeTools({dataRoot:tmpdir(),intentGoal:'turn on TV'})
  const names=tools.definitions.map(x=>x.function.name)
  for(const name of ['tv_control','hue_lights','home_device_inventory','home_device_control'])assert.ok(names.includes(name))
})

test('hub inventory accepts direct and polite listing requests',()=>{
  for(const text of ['Show my home hub devices.','List my devices','Can you show me my home hub devices?','Please list all my devices.'])
    assert.equal(bindHomeCall('home_device_inventory',{},text).ok,true,text)
})

test('hub inventory refuses negated and provider-restricted requests before dispatch',async()=>{
  let reads=0
  for(const text of ['Do not list my home hub devices','Do not use Home Assistant','Show my home hub devices but do not call Home Assistant','Show my devices without using the Hue bridge','Show my devices; no network calls','Do not list my devices; show my home hub devices']) {
    const tools=createHomeTools({dataRoot:tmpdir(),intentGoal:text,transports:{hubOptions:{hue:async()=>{reads++;throw Error('must not read')},client:{configured:true,discover:async()=>{reads++;throw Error('must not read')}}}}})
    const result=JSON.parse(await tools.call('home_device_inventory',{}))
    assert.equal(result.refused,true,text)
    assert.equal(result.executed,false,text)
  }
  assert.equal(reads,0)
})

test('hub inventory ignores quoted instructions and mere topic mentions',()=>{
  for(const text of ['Tell me what a home hub is','He said "show my home hub devices"','Explain `list my devices`','"Example. Show my devices. More text."',"She said 'list my devices'",'If I say show my devices, what will happen?'])
    assert.equal(bindHomeCall('home_device_inventory',{},text).ok,false,text)
})

test('unrelated negated device changes do not prevent requested inventory',()=>{
  for(const text of ['Do not turn on any lights; show my home hub devices.','Do not start the vacuum. Please list my devices.'])
    assert.equal(bindHomeCall('home_device_inventory',{},text).ok,true,text)
})
