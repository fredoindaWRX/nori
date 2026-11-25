import test from 'node:test'
import assert from 'node:assert/strict'
import {createLocationReceiver} from './receiver.mjs'
import {createLatestLocation} from './latest-location.mjs'
import {query} from '../../apps/desktop/bridge/nori-v2-query.mjs'

test('phone publish reaches native Nori without saved history, then pause clears it',async()=>{
  const phonePassword='integration-phone-credential-test-only-1111'
  const ownerPassword='integration-owner-credential-test-only-2222'
  let clock=Date.now()
  const store=createLatestLocation({now:()=>clock})
  const server=createLocationReceiver({phonePassword,ownerPassword,store})
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
  const endpoint=`http://127.0.0.1:${server.address().port}`
  const previous=[process.env.NORI_LOCATION_URL,process.env.NORI_LOCATION_OWNER_PASSWORD]
  process.env.NORI_LOCATION_URL=endpoint;process.env.NORI_LOCATION_OWNER_PASSWORD=ownerPassword
  const post=(role,password,path,body)=>fetch(endpoint+path,{method:'POST',headers:{authorization:`Basic ${Buffer.from(`${role}:${password}`).toString('base64')}`,'content-type':'application/json'},body:JSON.stringify(body)})
  let persisted=0
  async function ask(text='Where am I?'){
    async function* prompt(){yield {message:{content:text}}}
    const output=[]
    for await(const event of query({prompt:prompt(),options:{onConversationUpdate:()=>persisted++}}))output.push(event)
    return output.at(-1).result
  }
  try {
    assert.match(await ask(),/paused/)
    assert.match(await ask('Resume location sharing.'),/receiver is ready/)
    assert.match(await ask(),/not sent an update/)
    const result=await post('phone',phonePassword,'/location/update',{_type:'location',lat:10,lon:20,acc:8,tst:clock/1000})
    assert.equal(result.status,200)
    assert.match(await ask(),/latitude 10.00000, longitude 20.00000/)
    clock+=900001
    assert.match(await ask(),/cannot confirm where you are now/)
    assert.match(await ask('Pause location sharing.'),/cleared the last saved location/)
    assert.match(await ask(),/paused/)
    assert.equal(store.read().location,null)
    assert.equal(persisted,0,'Coordinates must not enter adapter saved conversation history')
  } finally {
    for(const [i,key] of ['NORI_LOCATION_URL','NORI_LOCATION_OWNER_PASSWORD'].entries()){
      if(previous[i]===undefined)delete process.env[key];else process.env[key]=previous[i]
    }
    server.closeAllConnections();await new Promise(resolve=>server.close(resolve))
  }
})
