import test from 'node:test'
import assert from 'node:assert/strict'
import {networkWatchReport,labelNetworkDevice} from '../bridge/network-watch.mjs'
test('canceled report does not invoke scanner or access inventory',async()=>{
 const abort=new AbortController();abort.abort(Error('owner canceled'))
 let calls=0
 await assert.rejects(networkWatchReport({dataRoot:null,signal:abort.signal,scan:async()=>{calls++;throw Error('unexpected scan')}}),/owner canceled/)
 assert.equal(calls,0)
 assert.throws(()=>labelNetworkDevice(null,{target:'192.168.1.2',label:'Test'},{signal:abort.signal}),/owner canceled/)
})
test('cancellation while scan completes prevents inventory persistence',async()=>{
 const abort=new AbortController()
 let received
 await assert.rejects(networkWatchReport({dataRoot:null,signal:abort.signal,scan:async options=>{
  received=options?.signal;abort.abort(Error('owner canceled'))
  return {devices:[],subnet:'192.168.1.0/24'}
 }}),/owner canceled/)
 assert.equal(received,abort.signal)
})
