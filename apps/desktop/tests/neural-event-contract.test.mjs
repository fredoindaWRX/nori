import test from 'node:test'
import assert from 'node:assert/strict'
import { NEURAL_EVENT_SCHEMA, validateNeuralEvent, createNeuralEventLedger, bindNeuralEvent } from '../bridge/neural-event-contract.mjs'
const base = {schema:NEURAL_EVENT_SCHEMA, type:'neural-event', ask:'turn:1', operation_id:'op:1', operation:'memory_recall', state:'started'}
const check = event => validateNeuralEvent(event, 'turn:1')

test('explicit operations map to regions without inventing successful completion', () => {
  for (const [operation, region] of Object.entries({memory_recall:'memory', memory_store:'memory', plan:'planning', policy_check:'protection', context_update:'working_memory'})) {
    const event = check({...base, operation})
    assert.equal(event.region, region)
    assert.equal(event.state, 'started')
    assert.equal(Object.isFrozen(event), true)
  }
})
test('stale turns, missing correlation and unknown operations are rejected', () => {
  for (const patch of [{ask:'turn:old'}, {operation_id:''}, {operation_id:'x'.repeat(129)}, {operation:'thinking'}, {operation:'toString'}, {state:'queued'}, {schema:'future'}]) assert.equal(check({...base, ...patch}), null)
  const missing = {...base}; delete missing.operation_id
  assert.equal(check(missing), null)
})
test('policy decisions cannot masquerade as successful execution', () => {
  assert.equal(check({...base, operation:'policy_check', state:'completed'}), null)
  assert.equal(check({...base, state:'allowed'}), null)
  for (const state of ['allowed','denied']) assert.equal(check({...base, operation:'policy_check', state}).state, state)
})
test('only completed recall permits bounded result counts', () => {
  assert.equal(check({...base, state:'completed', result_count:0}).result_count, 0)
  for (const result_count of [-1, 1.5, NaN, Infinity, 1_000_001, '3']) assert.equal(check({...base, state:'completed', result_count}), null)
  assert.equal(check({...base, result_count:3}), null)
  assert.equal(check({...base, operation:'plan', state:'completed', result_count:3}), null)
})
test('payload, getters, inherited fields and symbols are rejected without reading getters', () => {
  for (const key of ['prompt','payload','arguments','memory','reasoning','message']) assert.equal(check({...base, [key]:'private'}), null)
  let reads = 0
  const getter = {...base}; Object.defineProperty(getter,'state',{get(){reads++; return 'started'}})
  assert.equal(check(getter), null); assert.equal(reads,0)
  assert.equal(check(Object.create(base)), null)
  assert.equal(check({...base, [Symbol('secret')]:'private'}), null)
})
test('normalized events are independent snapshots and failure stays failure', () => {
  const source = {...base, state:'failed'}; const event = check(source)
  source.state = 'completed'
  assert.equal(event.state,'failed')
  for (const value of [null, [], 'event', 1]) assert.equal(check(value), null)
})

test('completion requires matching start, terminal events cannot replay', () => {
  const ledger = createNeuralEventLedger('turn:1')
  assert.equal(ledger.accept({...base, state:'completed'}),null)
  assert.equal(ledger.accept(base).state,'started')
  assert.equal(ledger.accept(base),null)
  assert.equal(ledger.accept({...base, operation:'plan', state:'completed'}),null)
  assert.equal(ledger.accept({...base, state:'completed', result_count:3}).result_count,3)
  assert.equal(ledger.accept({...base, state:'completed'}),null)
  assert.equal(ledger.accept(base),null)
})
test('failed, cancelled, and policy decisions are terminal observations', () => {
  for (const [operation,state] of [['memory_recall','failed'],['plan','cancelled'],['policy_check','denied'],['policy_check','allowed']]) {
    const ledger=createNeuralEventLedger('turn:1')
    assert.ok(ledger.accept({...base,operation}))
    assert.equal(ledger.accept({...base,operation,state}).state,state)
    assert.equal(ledger.accept({...base,operation,state}),null)
  }
})
test('turn closure blocks late events and cannot be undone', () => {
  const ledger=createNeuralEventLedger('turn:1')
  assert.equal(ledger.accept({...base,ask:'turn:old'}),null)
  assert.ok(ledger.accept(base))
  ledger.close(); ledger.close()
  assert.equal(ledger.accept({...base,state:'completed'}),null)
  assert.equal(ledger.accept({...base,operation_id:'new'}),null)
  assert.throws(()=>createNeuralEventLedger(''),TypeError)
})
test('ledger bounds storage without evicting terminal replay protection', () => {
  const ledger=createNeuralEventLedger('turn:1')
  for(let i=0;i<256;i++) {
    const event={...base,operation_id:`op:${i}`}
    assert.ok(ledger.accept(event))
    assert.ok(ledger.accept({...event,state:'completed'}))
  }
  assert.equal(ledger.accept({...base,operation_id:'overflow'}),null)
  assert.equal(ledger.accept({...base,operation_id:'op:0'}),null)
})

test('server turn binding rejects producer IDs and getters before reading them',()=>{
  const {ask,...metadata}=base
  const bound=bindNeuralEvent(metadata,'turn:1')
  assert.equal(bound.ask,'turn:1')
  assert.equal(bound.operation_id,metadata.operation_id)
  assert.equal(Object.isFrozen(bound),true)
  assert.equal(bindNeuralEvent(base,'turn:1'),null)
  assert.equal(bindNeuralEvent({...metadata,payload:'private'},'turn:1'),null)
  assert.equal(bindNeuralEvent(metadata,null),null)
  let reads=0
  Object.defineProperty(metadata,'state',{get(){reads++;return 'started'}})
  assert.equal(bindNeuralEvent(metadata,'turn:1'),null)
  assert.equal(reads,0)
})
