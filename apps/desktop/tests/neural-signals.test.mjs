import test from 'node:test'
import assert from 'node:assert/strict'
import { bridgeNeuralSignal, liveNeuralSignals, observeBridgeNeuralSignal, observedNeuralSignals, neuralSignalProgress, clearNeuralSignals } from '../src/scene/neural-signals.ts'
import { createNeuralEventLedger, NEURAL_EVENT_SCHEMA } from '../bridge/neural-event-contract.mjs'
import { NEURAL_REGIONS } from '../src/scene/neural-activity.ts'

test('accepted text and tool frames identify UI transport endpoints', () => {
  assert.deepEqual(bridgeNeuralSignal({type:'text', ask:'live', delta:'hello'}, 'live', 10), {from:'connections',to:'language',at:10})
  assert.deepEqual(bridgeNeuralSignal({type:'tool', ask:'live', name:'recall_memory'}, 'live', 10), {from:'connections',to:'tools',at:10})
})
test('stale and untagged turns cannot create activity', () => {
  for (const ask of ['old', undefined, null]) assert.equal(bridgeNeuralSignal({type:'text',ask,delta:'hello'}, 'live',10), null)
})
test('malformed, empty, lifecycle and error frames do not invent processing', () => {
  for (const frame of [null, 3, {}, {ask:'live',type:'text',delta:5}, {ask:'live',type:'text',delta:''}, {ask:'live',type:'tool',name:' '}, {ask:'live',type:'error',message:'failed'}, {ask:'live',type:'ready'}])
    assert.equal(bridgeNeuralSignal(frame,'live',10), null)
  for (const now of [NaN, Infinity, -1]) assert.equal(bridgeNeuralSignal({ask:'live',type:'text',delta:'x'},'live',now),null)
})
test('observations omit prompt, payload and arguments', () => {
  const signal = bridgeNeuralSignal({ask:'live',type:'tool',name:'Read',args:{secret:'private'},text:'private'},'live',10)
  assert.deepEqual(Object.keys(signal).sort(), ['at','from','to'])
})
test('signals expire exactly at one second and reject future timestamps', () => {
  const signal = {from:'connections',to:'language',at:10}
  assert.deepEqual(liveNeuralSignals([signal],1009),[signal])
  assert.deepEqual(liveNeuralSignals([signal],1010),[])
  assert.deepEqual(liveNeuralSignals([signal],9),[])
  assert.deepEqual(liveNeuralSignals([signal],NaN),[])
})
test('long streams retain only one in-flight observation for each of two routes', () => {
  for(let i=0;i<10000;i++) observeBridgeNeuralSignal({ask:'live',type:'text',delta:'x'},'live',i)
  observeBridgeNeuralSignal({ask:'live',type:'tool',name:'Read'},'live',9999)
  assert.equal(observedNeuralSignals(9999).length,2)
  assert.deepEqual(observedNeuralSignals(11000),[])
})
test('continuous text cannot pin a traveling pulse at the source', () => {
  observedNeuralSignals(20000)
  const frame = {ask:'live',type:'text',delta:'x'}
  observeBridgeNeuralSignal(frame,'live',20000)
  for (let offset=100; offset<1000; offset+=100) {
    observeBridgeNeuralSignal(frame,'live',20000+offset)
    const [signal] = observedNeuralSignals(20000+offset)
    assert.equal(signal.at,20000)
    assert.equal(neuralSignalProgress(signal,20000+offset),offset/1000)
  }
  assert.deepEqual(observedNeuralSignals(21000),[])
  observeBridgeNeuralSignal(frame,'live',21000)
  assert.equal(neuralSignalProgress(observedNeuralSignals(21000)[0],21000),0)
})
test('simultaneous text and tool routes travel independently', () => {
  observedNeuralSignals(30000)
  observeBridgeNeuralSignal({ask:'live',type:'text',delta:'x'},'live',30000)
  observeBridgeNeuralSignal({ask:'live',type:'tool',name:'Read'},'live',30500)
  const signals = observedNeuralSignals(30900)
  assert.deepEqual(signals.map(signal=>[signal.to,neuralSignalProgress(signal,30900)]),[['language',.9],['tools',.4]])
  observedNeuralSignals(32000)
})
test('cancellation clears both routes and stale frames cannot restore them', () => {
  clearNeuralSignals()
  observeBridgeNeuralSignal({ask:'old',type:'text',delta:'x'},'old',40000)
  observeBridgeNeuralSignal({ask:'old',type:'tool',name:'Read'},'old',40000)
  assert.equal(observedNeuralSignals(40000).length,2)
  clearNeuralSignals()
  assert.deepEqual(observedNeuralSignals(40001),[])
  observeBridgeNeuralSignal({ask:'old',type:'text',delta:'late'},'new',40002)
  assert.deepEqual(observedNeuralSignals(40002),[])
  observeBridgeNeuralSignal({ask:'new',type:'text',delta:'new'},'new',40003)
  assert.equal(observedNeuralSignals(40003)[0].at,40003)
  clearNeuralSignals()
})

test('validated subsystem lifecycle reaches real sphere regions; no ledger means no observation', () => {
  const event={schema:NEURAL_EVENT_SCHEMA,type:'neural-event',ask:'live',operation_id:'op1',operation:'memory_recall',state:'started'}
  clearNeuralSignals()
  observeBridgeNeuralSignal(event,'live',50000)
  assert.deepEqual(observedNeuralSignals(50000),[])
  const ledger=createNeuralEventLedger('live')
  observeBridgeNeuralSignal({...event,state:'completed'},'live',50000,ledger)
  assert.deepEqual(observedNeuralSignals(50000),[])
  observeBridgeNeuralSignal(event,'live',50000,ledger)
  assert.deepEqual(observedNeuralSignals(50000),[{from:'connections',to:'memory',at:50000,state:'started'}])
  assert.ok(NEURAL_REGIONS.includes(observedNeuralSignals(50000)[0].to))
  observeBridgeNeuralSignal({...event,state:'completed',result_count:2},'live',51100,ledger)
  assert.equal(observedNeuralSignals(51100)[0].at,51100)
  clearNeuralSignals()
  observeBridgeNeuralSignal({...event,state:'completed'},'live',52200,ledger)
  assert.deepEqual(observedNeuralSignals(52200),[])
  ledger.close()
  observeBridgeNeuralSignal({...event,operation_id:'late'},'live',52201,ledger)
  assert.deepEqual(observedNeuralSignals(52201),[])
})

test('context, policy and plan observations stay payload-free and travel to existing regions', () => {
  clearNeuralSignals()
  const ledger=createNeuralEventLedger('live')
  for (const [operation,to] of [['context_update','working_memory'],['policy_check','protection'],['plan','planning']]) {
    const frame={schema:NEURAL_EVENT_SCHEMA,type:'neural-event',ask:'live',operation_id:operation,operation,state:'started'}
    observeBridgeNeuralSignal({...frame,payload:'private'},'live',60000,ledger)
    observeBridgeNeuralSignal(frame,'live',60000,ledger)
    assert.ok(NEURAL_REGIONS.includes(to))
  }
  assert.deepEqual(observedNeuralSignals(60000).map(s=>s.to),['working_memory','protection','planning'])
  assert.ok(observedNeuralSignals(60000).every(s=>Object.keys(s).length===4 && s.state==='started'))
  ledger.close(); clearNeuralSignals()
})

test('terminal outcomes recolor an in-flight pulse without restarting travel or accepting replay',async()=>{
  const {neuralSignalColor}=await import('../src/scene/neural-signals.ts')
  for(const terminal of ['completed','failed','cancelled','allowed','denied']) {
    clearNeuralSignals()
    const ledger=createNeuralEventLedger('live')
    const event={schema:NEURAL_EVENT_SCHEMA,type:'neural-event',ask:'live',operation_id:terminal,
      operation:['allowed','denied'].includes(terminal)?'policy_check':'plan',state:'started'}
    observeBridgeNeuralSignal(event,'live',70000,ledger)
    observeBridgeNeuralSignal({...event,state:terminal},'live',70200,ledger)
    const [signal]=observedNeuralSignals(70200)
    assert.equal(signal.at,70000)
    assert.equal(signal.state,terminal)
    assert.equal(neuralSignalProgress(signal,70200),.2)
    const color=neuralSignalColor(signal)
    assert.deepEqual(color,terminal==='cancelled'?[1,.65,.15]:['completed','allowed'].includes(terminal)?[.2,1,.55]:[1,.18,.22])
    observeBridgeNeuralSignal({...event,state:terminal},'live',70300,ledger)
    assert.equal(observedNeuralSignals(70300)[0].at,70000)
    ledger.close()
  }
  clearNeuralSignals()
})
