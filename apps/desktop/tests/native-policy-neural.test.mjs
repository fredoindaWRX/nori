import test from 'node:test'
import assert from 'node:assert/strict'
import { query } from '../bridge/nori-v2-query.mjs'
import { createNeuralEventLedger } from '../bridge/neural-event-contract.mjs'

test('native durable permission denial emits a real correlated policy decision before refusal', async () => {
  async function* prompt(){yield {message:{content:'*work verify this request'}}}
  const messages=[]
  for await (const message of query({prompt:prompt(),options:{allowWrites:false}})) messages.push(message)
  const observations=messages.filter(message=>message.type==='neural-event')
  assert.equal(observations.length,2)
  assert.deepEqual(observations.map(event=>event.state),['started','denied'])
  assert.equal(observations[0].operation_id,observations[1].operation_id)
  const ledger=createNeuralEventLedger('test-turn')
  for(const event of observations) {
    const accepted=ledger.accept({...event,ask:'test-turn'})
    assert.equal(accepted.region,'protection')
    assert.equal(Object.hasOwn(accepted,'prompt'),false)
  }
  const result=messages.find(message=>message.type==='result')
  assert.equal(result.error_code,'NORI_READ_ONLY')
  assert.ok(messages.indexOf(observations[1])<messages.indexOf(result))
  ledger.close()
})
