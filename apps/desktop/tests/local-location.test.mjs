import test from 'node:test'
import assert from 'node:assert/strict'
import {createServer} from 'node:http'
import {locationAnswer,isLocationQuestion,locationControl} from '../bridge/local-location.mjs'
test('location controls require an explicit complete command',()=>{
  assert.equal(locationControl('Pause location sharing.'),'pause')
  assert.equal(locationControl('Enable location sharing'),'enable')
  assert.equal(locationControl('Should I enable location sharing?'),null)
  assert.equal(locationControl('An article says enable location sharing'),null)
})
test('location questions use narrow explicit intent',()=>{
  assert.equal(isLocationQuestion('Where am I?'),true)
  assert.equal(isLocationQuestion('Where am I in the project plan?'),false)
})
test('unconfigured location does not guess',async()=>assert.match(await locationAnswer({endpoint:'',password:''}),/not connected/))
test('location reader authenticates locally and distinguishes latest, stale and paused',async()=>{
  let state={enabled:true,location:{latitude:42,longitude:-71,accuracyMeters:12,timestamp:1000},stale:false}
  const server=createServer((req,res)=>{
    assert.equal(req.headers.authorization,`Basic ${Buffer.from('owner:test-only-password').toString('base64')}`)
    res.end(JSON.stringify(state))
  })
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
  const options={endpoint:`http://127.0.0.1:${server.address().port}`,password:'test-only-password',now:()=>1000000}
  try {
    assert.match(await locationAnswer(options),/latitude 42.00000/)
    state.stale=true;assert.match(await locationAnswer(options),/cannot confirm/)
    state.enabled=false;assert.match(await locationAnswer(options),/paused/)
  } finally {server.closeAllConnections();await new Promise(resolve=>server.close(resolve))}
})
test('remote receiver is refused without network access',async()=>assert.match(await locationAnswer({endpoint:'https://example.com',password:'test'}),/unavailable/))
test('native location turn bypasses model and conversation persistence',async()=>{
  const {query}=await import('../bridge/nori-v2-query.mjs?location-test')
  const previous=process.env.NORI_LOCATION_URL;delete process.env.NORI_LOCATION_URL
  let saved=0;const messages=[]
  async function* prompt(){yield {message:{content:'Where am I?'}}}
  try {
    for await(const item of query({prompt:prompt(),options:{onConversationUpdate:()=>saved++}}))messages.push(item)
    assert.equal(saved,0)
    assert.match(messages.at(-1).result,/not connected/)
  } finally {if(previous!==undefined)process.env.NORI_LOCATION_URL=previous}
})
