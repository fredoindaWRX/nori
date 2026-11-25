import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'
import * as personalityContract from '../bridge/personality/profile.mjs'
import * as neuralSignals from '../src/scene/neural-signals.ts'
import * as neuralContract from '../bridge/neural-event-contract.mjs'

function client() {
  const instances=[]
  const speechPersonalities=[]
  class Socket {
    static OPEN=1
    readyState=0
    listeners=[]
    sent=[]
    constructor(url) { this.url=url; instances.push(this) }
    addEventListener(type,callback) { if(type==='message')this.listeners.push(callback) }
    removeEventListener(type,callback) { this.listeners=this.listeners.filter(fn=>fn!==callback) }
    send(text) { this.sent.push(JSON.parse(text)) }
    open() { this.readyState=1; this.onopen() }
    frame(frame) { for(const fn of this.listeners)fn({data:JSON.stringify(frame)}) }
    close() { this.readyState=3; this.onclose?.() }
  }
  const context={exports:{},require:name=>name.endsWith('/tts')
    ? {setSpeechPersonality:value=>speechPersonalities.push(value)}
    : name.endsWith('personality/profile.mjs')
    ? personalityContract : name.endsWith('neural-signals') ? neuralSignals
      : name.endsWith('neural-event-contract.mjs') ? neuralContract : ({BRIDGE_WS_URL:'ws://127.0.0.1:43210'}),
    WebSocket:Socket,location:{port:'43209'},console,clearTimeout,performance,JSON,
    setTimeout:(fn,ms)=>{const timer=setTimeout(fn,ms);timer.unref();return timer}}
  context.window=context
  const source=readFileSync(new URL('../src/lib/bridge.ts',import.meta.url),'utf8')
  vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,context)
  return {api:context.exports,instances,speechPersonalities}
}
const ready={type:'ready',servers:['Nori Core'],model:'nori-20b-son-development-pending',effort:'balanced',
  models:[{id:'nori-20b-son-development-pending',label:'Nori SoN development fixture'}],efforts:['lightning-fast','balanced','deep']}

test('standby warm announces real metadata without asking a model or arming capture',async()=>{
  const {api,instances}=client();let info,servers
  api.watchBridgeInfo(value=>{info=value});api.watchServers(value=>{servers=value})
  const warming=api.warmBridge();instances[0].open();instances[0].frame(ready);await warming
  assert.equal(instances[0].url,'ws://127.0.0.1:43210')
  assert.equal(info.model,ready.model);assert.equal(info.efforts.length,3)
  assert.equal(servers[0],'Nori Core');assert.deepEqual(instances[0].sent,[])
})
test('warming after the intro reuses the socket and late subscribers receive metadata',async()=>{
  const {api,instances}=client()
  const warming=api.warmBridge();instances[0].open();instances[0].frame(ready);await warming
  await api.warmBridge();let info,servers
  api.watchBridgeInfo(value=>{info=value});api.watchServers(value=>{servers=value})
  assert.equal(instances.length,1);assert.equal(info.model,ready.model);assert.equal(servers[0],'Nori Core')
  await api.configure({effort:'deep'})
  assert.deepEqual(instances[0].sent,[{type:'config',effort:'deep'}])
})
test('configuration waits for the bridge to open instead of silently dropping the request',async()=>{
  const {api,instances}=client()
  const configuration=api.configure({fresh:true})
  assert.equal(instances.length,1)
  instances[0].open()
  await configuration
  assert.deepEqual(instances[0].sent,[{type:'config',fresh:true}])
})
test('configuration reports a failed bridge connection to its caller',async()=>{
  const {api,instances}=client()
  const configuration=api.configure({fresh:true})
  const rejected=assert.rejects(configuration,/Cannot reach the bridge/)
  instances[0].onerror()
  await rejected
})
test('disconnect clears linked systems and does not replay stale model metadata',async()=>{
  const {api,instances,speechPersonalities}=client();let servers,info,personality
  api.watchServers(value=>{servers=value})
  const warming=api.warmBridge();instances[0].open();instances[0].frame(ready);await warming
  instances[0].close();api.watchBridgeInfo(value=>{info=value});api.watchPersonality(value=>{personality=value})
  assert.equal(servers.length,0);assert.equal(api.bridgeServers().length,0);assert.equal(info,undefined)
  assert.equal(personality,null);assert.deepEqual(speechPersonalities,[null])
})
test('renderer transport keeps tab background separate from actual user words',async()=>{
  const {api,instances}=client()
  const warming=api.warmBridge();instances[0].open();instances[0].frame(ready);await warming
  const reply=api.ask('Hi lol',{},null,'[Open tabs: Workspace test panel emergency]')
  await new Promise(resolve=>setImmediate(resolve))
  const sent=instances[0].sent.at(-1)
  assert.equal(sent.text,'Hi lol')
  assert.equal(sent.context,'[Open tabs: Workspace test panel emergency]')
  instances[0].frame({type:'done',text:'Hello.',ask:sent.id})
  assert.equal((await reply).text,'Hello.')
})

test('actual bridge turn handler observes accepted transport and cancel clears it',async()=>{
  neuralSignals.clearNeuralSignals()
  const {api,instances}=client()
  const warming=api.warmBridge();instances[0].open();instances[0].frame(ready);await warming
  const texts=[],tools=[]
  const reply=api.ask('Synthetic transport test',{onText:text=>texts.push(text),onTool:name=>tools.push(name)})
  await new Promise(resolve=>setImmediate(resolve))
  const socket=instances[0], ask=socket.sent.at(-1).id
  socket.frame({type:'text',ask:'superseded',delta:'ignored'})
  assert.equal(neuralSignals.observedNeuralSignals().length,0)
  socket.frame({type:'text',ask,delta:'accepted'})
  socket.frame({type:'tool',ask,name:'Read'})
  assert.deepEqual(texts,['accepted']);assert.deepEqual(tools,['Read'])
  assert.deepEqual(neuralSignals.observedNeuralSignals().map(signal=>signal.to),['language','tools'])
  api.cancel()
  assert.equal(neuralSignals.observedNeuralSignals().length,0)
  assert.equal(socket.sent.at(-1).type,'interrupt')
  socket.frame({type:'text',ask,delta:'late'})
  assert.equal(neuralSignals.observedNeuralSignals().length,0)
  assert.equal((await reply).text,'accepted')
})

test('failed reply clears transport activity and removes its turn listener',async()=>{
  neuralSignals.clearNeuralSignals()
  const {api,instances}=client()
  const warming=api.warmBridge();instances[0].open();instances[0].frame(ready);await warming
  const reply=api.ask('Synthetic failure test',{onText:()=>{},onTool:()=>{}})
  const rejected=assert.rejects(reply,/Synthetic transport failure/)
  await new Promise(resolve=>setImmediate(resolve))
  const socket=instances[0],ask=socket.sent.at(-1).id
  socket.frame({type:'text',ask,delta:'accepted'})
  assert.equal(neuralSignals.observedNeuralSignals().length,1)
  socket.frame({type:'error',ask,message:'Synthetic transport failure'})
  await rejected
  assert.equal(neuralSignals.observedNeuralSignals().length,0)
  socket.frame({type:'tool',ask,name:'Read'})
  assert.equal(neuralSignals.observedNeuralSignals().length,0)
})

test('actual bridge accepts subsystem lifecycle metadata and rejects replay or late cancelled events',async()=>{
  neuralSignals.clearNeuralSignals()
  const {api,instances}=client()
  const warming=api.warmBridge();instances[0].open();instances[0].frame(ready);await warming
  const socket=instances[0], baseline=socket.listeners.length
  const reply=api.ask('Synthetic subsystem telemetry',{})
  await new Promise(resolve=>setImmediate(resolve))
  const ask=socket.sent.at(-1).id
  const event={schema:neuralContract.NEURAL_EVENT_SCHEMA,type:'neural-event',ask,operation_id:'op-memory',operation:'memory_recall',state:'started'}
  assert.equal(socket.listeners.length,baseline+1)
  socket.frame({...event,ask:'superseded'})
  socket.frame({...event,state:'completed'})
  socket.frame({...event,payload:'private memory'})
  assert.deepEqual(neuralSignals.observedNeuralSignals(),[])
  socket.frame(event)
  assert.deepEqual(neuralSignals.observedNeuralSignals().map(s=>s.to),['memory'])
  neuralSignals.clearNeuralSignals()
  socket.frame({...event,state:'completed',result_count:3})
  assert.deepEqual(neuralSignals.observedNeuralSignals().map(s=>s.to),['memory'])
  neuralSignals.clearNeuralSignals()
  socket.frame({...event,state:'completed',result_count:3})
  assert.deepEqual(neuralSignals.observedNeuralSignals(),[])
  socket.frame({...event,operation_id:'op-context',operation:'context_update'})
  assert.deepEqual(neuralSignals.observedNeuralSignals().map(s=>s.to),['working_memory'])
  api.cancel(); await reply
  assert.equal(socket.listeners.length,baseline)
  socket.frame({...event,operation_id:'late'})
  assert.deepEqual(neuralSignals.observedNeuralSignals(),[])
})

test('superseding a turn gives the new turn its own operation ledger',async()=>{
  neuralSignals.clearNeuralSignals()
  const {api,instances}=client()
  const warming=api.warmBridge();instances[0].open();instances[0].frame(ready);await warming
  const socket=instances[0],baseline=socket.listeners.length
  const first=api.ask('First synthetic turn',{})
  await new Promise(resolve=>setImmediate(resolve))
  const oldAsk=socket.sent.at(-1).id
  const second=api.ask('Second synthetic turn',{})
  await new Promise(resolve=>setImmediate(resolve))
  await first
  const ask=socket.sent.at(-1).id
  const event={schema:neuralContract.NEURAL_EVENT_SCHEMA,type:'neural-event',operation_id:'same-id',operation:'policy_check',state:'started'}
  socket.frame({...event,ask:oldAsk})
  assert.deepEqual(neuralSignals.observedNeuralSignals(),[])
  socket.frame({...event,ask})
  assert.deepEqual(neuralSignals.observedNeuralSignals().map(s=>s.to),['protection'])
  socket.frame({type:'done',ask,text:'Synthetic completion'})
  await second
  assert.equal(socket.listeners.length,baseline)
  neuralSignals.clearNeuralSignals()
  socket.frame({...event,ask,state:'denied'})
  assert.deepEqual(neuralSignals.observedNeuralSignals(),[])
})
