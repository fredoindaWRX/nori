import test from 'node:test'
import assert from 'node:assert/strict'
import {hueRequest,pairHue} from '../bridge/hue.mjs'
test('already canceled Hue requests and pairing stop before storage or transport',async()=>{
 const abort=new AbortController();abort.abort(Error('owner canceled'))
 let calls=0
 const options={dataRoot:null,signal:abort.signal,fetcher:async()=>{calls++;throw Error('unexpected transport')}}
 await assert.rejects(hueRequest('turn off office lights',options),/owner canceled/)
 await assert.rejects(pairHue(null,options).next(),/owner canceled/)
 assert.equal(calls,0)
})
