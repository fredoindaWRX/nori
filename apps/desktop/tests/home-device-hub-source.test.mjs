import test from 'node:test'
import assert from 'node:assert/strict'
import {createHomeAssistantClient,ownerRequested} from '../bridge/home-device-hub.mjs'

test('home inventory reports transport failure without claiming verified devices',async()=>{
 let calls=0
 const client=createHomeAssistantClient({config:{base_url:'http://127.0.0.1:8123',token:'synthetic'},fetcher:async()=>{calls++;throw Error('Synthetic offline')}})
 const result=await client.discover()
 assert.equal(result.success,false)
 assert.equal(result.error,'home_assistant_unreachable')
 assert.equal(calls,2)
})
test('home commands reject mismatched or unavailable targets before sending a change',async()=>{
 const calls=[]
 const client=createHomeAssistantClient({config:{base_url:'http://127.0.0.1:8123',token:'synthetic'},fetcher:async(url,options)=>{
  calls.push(options.method)
  return Response.json(url.endsWith('/api/services')?[{domain:'light',services:{turn_on:{}}}]:[{entity_id:'light.office',state:'off',attributes:{friendly_name:'Office lamp'}}])
 }})
 const result=await client.command('light.office','turn_on','turn off Office lamp')
 assert.equal(result.success,false)
 assert.equal(result.error,'owner_request_does_not_match')
 assert.ok(calls.every(method=>method==='GET'))
 assert.equal(ownerRequested('do not turn on Office lamp','turn_on','light.office','Office lamp'),false)
})
