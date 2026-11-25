import test from 'node:test'
import assert from 'node:assert/strict'
import { observeLocalMemoryContext } from '../bridge/native-memory-observation.mjs'
import { createNeuralEventLedger } from '../bridge/neural-event-contract.mjs'

test('local memory selection is bracketed by correlated payload-free observations',()=>{
  const order=[],events=[]
  const result=observeLocalMemoryContext(()=>{order.push('read');return 'private guidance'},event=>{order.push(event.state);events.push(event)})
  assert.equal(result,'private guidance')
  assert.deepEqual(order,['started','read','completed'])
  const ledger=createNeuralEventLedger('fixture-turn')
  for(const event of events)assert.equal(ledger.accept({...event,ask:'fixture-turn'}).region,'memory')
  assert.equal(events[0].operation_id,events[1].operation_id)
  assert.ok(!JSON.stringify(events).includes('private guidance'))
  assert.ok(events.every(Object.isFrozen))
  ledger.close()
})
test('empty context is successful cache selection; read failures are preserved',()=>{
  const empty=[]
  assert.equal(observeLocalMemoryContext(()=>'',event=>empty.push(event.state)),'')
  assert.deepEqual(empty,['started','completed'])
  const failed=[],error=new Error('synthetic read failure')
  assert.throws(()=>observeLocalMemoryContext(()=>{throw error},event=>failed.push(event.state)),value=>value===error)
  assert.deepEqual(failed,['started','failed'])
})
test('missing or broken visualization cannot change memory result or failure',()=>{
  assert.equal(observeLocalMemoryContext(()=> 'guidance'),'guidance')
  assert.equal(observeLocalMemoryContext(()=> 'guidance',()=>{throw Error('delivery failed')}),'guidance')
  const error=Error('read failed')
  assert.throws(()=>observeLocalMemoryContext(()=>{throw error},()=>{throw Error('delivery failed')}),value=>value===error)
})
