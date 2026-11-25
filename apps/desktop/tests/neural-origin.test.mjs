import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import vm from 'node:vm'
import {bindNeuralEvent} from '../bridge/neural-event-contract.mjs'
import {createNeuralOrigin,attachNeuralOrigin,neuralOriginOf,ownsNeuralObservation} from '../bridge/neural-origin.mjs'
import {encodeNeuraleseUserContent} from '../bridge/neuralese-intent.mjs'

test('origin cannot be serialized, forged or reused across sessions with the same turn ID',()=>{
  const first=createNeuralOrigin('turn-1'), restarted=createNeuralOrigin('turn-1')
  const event=attachNeuralOrigin({type:'neural-event'},first)
  assert.equal(neuralOriginOf(event),first)
  assert.equal(neuralOriginOf(JSON.parse(JSON.stringify(event))),null)
  assert.equal(ownsNeuralObservation(first,restarted),false)
  assert.equal(ownsNeuralObservation({turnId:'turn-1'},first),false)
  assert.equal(ownsNeuralObservation(first,null),false)
  assert.equal(createNeuralOrigin(''),null)
})

test('actual native adapter retains each queued request origin and rejects its delayed event after replacement',async()=>{
  const {query}=await import('../bridge/nori-v2-query.mjs')
  const first=createNeuralOrigin('first'), second=createNeuralOrigin('second')
  const messages=[first,second].map(origin=>attachNeuralOrigin({message:{content:'*work inspect fixture'},nori_context:'fixture context'},origin))
  async function* prompt(){yield* messages}
  const events=[]
  for await(const event of query({prompt:prompt(),options:{allowWrites:false}})) {
    if(event.type==='neural-event')events.push(event)
  }
  assert.equal(events.length,4)
  assert.deepEqual(events.map(neuralOriginOf),[first,first,second,second])
  assert.equal(ownsNeuralObservation(neuralOriginOf(events[0]),second),false)
  assert.equal(ownsNeuralObservation(neuralOriginOf(events[2]),second),true)
  assert.deepEqual(events.map(event=>event.state),['started','denied','started','denied'])
  assert.ok(events.every(event=>!Object.hasOwn(event,'ask')))
})

test('production observation callback suppresses replaced, interrupted and closing request observations',()=>{
  const source=readFileSync(new URL('../bridge/server.mjs',import.meta.url),'utf8')
  const match=source.match(/onNeuralObservation: (\(metadata, origin\) => \{[\s\S]*?\n      \}),/)
  assert.ok(match,'production callback must be located')
  const first=createNeuralOrigin('same-id'), second=createNeuralOrigin('same-id')
  const sent=[]
  // Use the actual production callback, with host-side metadata validation.
  const context={closed:false,activeNeuralOrigin:first,answering:'same-id',
    ownsNeuralObservation,bindNeuralEvent,send:event=>sent.push(event)}
  const callback=vm.runInNewContext(`(${match[1]})`,context)
  const event={schema:'nori.neural-event.v1',type:'neural-event',operation_id:'plan-1',operation:'plan',state:'started'}
  callback(event,first)
  assert.equal(sent.length,1)
  context.activeNeuralOrigin=second
  callback(event,first)
  assert.equal(sent.length,1)
  callback(event,second)
  assert.equal(sent.length,2)
  context.activeNeuralOrigin=null
  callback(event,second)
  assert.equal(sent.length,2)
  context.activeNeuralOrigin=second
  context.closed=true
  callback(event,second)
  assert.equal(sent.length,2)
})

test('native memory callbacks retain captured request identity without serializing context or identity',async()=>{
  const {query}=await import('../bridge/nori-v2-query.mjs')
  const first=createNeuralOrigin('memory-first'), second=createNeuralOrigin('memory-second')
  const observed=[],results=[],commands=[]
  const inputs=[first,second].map(origin=>attachNeuralOrigin({
    message:{content:'Turn the interface ghost purple.'},nori_context:'PRIVATE_FIXTURE_CONTEXT',
  },origin))
  async function* prompt(){yield* inputs}
  for await(const event of query({prompt:prompt(),options:{
    nativeUi:(operation,args,origin)=>commands.push({operation,args,origin}),
    onNeuralObservation:(event,origin)=>observed.push({event,origin}),
  }})) if(event.type==='result')results.push(event)
  assert.equal(commands.length,2)
  assert.deepEqual(commands.map(command=>command.origin),[first,second])
  assert.equal(results.length,2)
  assert.ok(results.every(event=>event.subtype==='success'))
  assert.deepEqual(observed.map(item=>item.origin),[first,first,second,second])
  assert.deepEqual(observed.map(item=>item.event.state),['started','completed','started','completed'])
  const metadata=JSON.stringify(observed.map(item=>item.event))
  for(const forbidden of ['PRIVATE_FIXTURE_CONTEXT','memory-first','memory-second','Turn the interface'])
    assert.ok(!metadata.includes(forbidden))
  assert.equal(ownsNeuralObservation(observed[0].origin,second),false)
  assert.equal(ownsNeuralObservation(observed[2].origin,second),true)
})

test('production input generator preserves queued text, screenshots, context and request ownership',async()=>{
  const source=readFileSync(new URL('../bridge/server.mjs',import.meta.url),'utf8')
  const begin=source.indexOf('  async function* userMessages() {')
  const end=source.indexOf('\n  const send =',begin)
  assert.ok(begin>=0 && end>begin)
  const first=createNeuralOrigin('plain'), second=createNeuralOrigin('screen')
  const context={closed:false,deliver:null,attachNeuralOrigin,encodeNeuraleseUserContent,inbox:[
    {text:'Exact plain text',origin:first},
    {text:{text:'Explain this screenshot',image:{mimeType:'image/png',data:'FIXTURE_BASE64'},context:'Exact reference context'},origin:second},
  ]}
  const factory=vm.runInNewContext(`${source.slice(begin,end)}; userMessages`,context)
  const messages=factory()
  const plain=(await messages.next()).value
  assert.equal(plain.message.content,'Exact plain text')
  assert.equal(neuralOriginOf(plain),first)
  const screenshot=(await messages.next()).value
  assert.equal(neuralOriginOf(screenshot),second)
  assert.equal(screenshot.nori_context,'Exact reference context')
  assert.equal(screenshot.message.content[0].type,'image')
  assert.equal(screenshot.message.content[0].source.media_type,'image/png')
  assert.equal(screenshot.message.content[0].source.data,'FIXTURE_BASE64')
  assert.equal(screenshot.message.content[1].text,'[The user is sharing their screen; this is it right now.]\nExplain this screenshot')
  assert.equal(screenshot.parent_tool_use_id,null)
  const pending=messages.next()
  assert.equal(typeof context.deliver,'function')
  context.closed=true
  context.deliver(null)
  assert.equal((await pending).done,true)
})

test('production image callback delivers active image and rejects obsolete, closing or disconnected requests',async()=>{
  const source=readFileSync(new URL('../bridge/server.mjs',import.meta.url),'utf8')
  const begin=source.indexOf('      nativeImage: ')
  const end=source.indexOf('\n      nativeArtifact:',begin)
  assert.ok(begin>=0 && end>begin)
  const expression=source.slice(begin+'      nativeImage: '.length,end).trim().replace(/,$/,'')
  const active=createNeuralOrigin('image-current'), obsolete=createNeuralOrigin('image-old')
  const sent=[]
  const socket={OPEN:1,readyState:1,send:(value,ack)=>{sent.push(JSON.parse(value));ack()}}
  const context={closed:false,activeNeuralOrigin:active,ownsNeuralObservation,socket}
  const callback=vm.runInNewContext(`(${expression})`,context)
  const image={data:'SYNTHETIC_IMAGE_DATA',mimeType:'image/png'}
  await callback(image,active)
  assert.equal(sent.length,1)
  assert.equal(sent[0].type,'blade')
  assert.equal(sent[0].blade.url,'data:image/png;base64,SYNTHETIC_IMAGE_DATA')
  assert.throws(()=>callback(image,obsolete),/no longer active/)
  assert.throws(()=>callback(image,{turnId:'image-current'}),/no longer active/)
  context.closed=true
  assert.throws(()=>callback(image,active),/no longer active/)
  context.closed=false
  socket.readyState=3
  assert.throws(()=>callback(image,active),/disconnected/)
  assert.equal(sent.length,1)
})

test('superseded native request cannot mutate conversation history',async()=>{
  const {query}=await import('../bridge/nori-v2-query.mjs')
  const old=createNeuralOrigin('history-old'), active=createNeuralOrigin('history-current')
  const updates=[],commands=[],observations=[]
  async function* prompt(){
    for(const origin of [old,active])yield attachNeuralOrigin({message:{content:'Turn the interface ghost purple.'}},origin)
  }
  for await(const event of query({prompt:prompt(),options:{nativeUi:(op,args,origin)=>commands.push(origin),
    isRequestActive:origin=>ownsNeuralObservation(origin,active),
    onConversationUpdate:(history,origin)=>updates.push({history,origin}),
    onNeuralObservation:(event,origin)=>observations.push(origin),
  }})) {}
  assert.equal(updates.length,1)
  assert.equal(updates[0].origin,active)
  assert.equal(updates[0].history.length,2)
  assert.deepEqual(updates[0].history.map(turn=>turn.role),['user','nori'])
  assert.deepEqual(commands,[active])
  assert.deepEqual(observations,[active,active])
})

test('production personality start callback ignores superseded or closing requests',()=>{
  const source=readFileSync(new URL('../bridge/server.mjs',import.meta.url),'utf8')
  const match=source.match(/onPersonalityTurn: (\(text, origin\) => \{[\s\S]*?\n      \}),/)
  assert.ok(match)
  const old=createNeuralOrigin('personality-old'), active=createNeuralOrigin('personality-current')
  const starts=[]
  let published=0
  const context={closed:false,activeNeuralOrigin:active,ownsNeuralObservation,
    personality:{startTurn:(text,options)=>starts.push({text,options})},
    needsCouncil:()=>false,publishPersonality:()=>published++}
  const callback=vm.runInNewContext(`(${match[1]})`,context)
  callback('old request',old)
  callback('current request',active)
  assert.equal(starts.length,1)
  assert.equal(starts[0].text,'current request')
  context.closed=true
  callback('closing request',active)
  assert.equal(starts.length,1)
  assert.equal(published,1)
})
