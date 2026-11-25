import test from 'node:test'
import assert from 'node:assert/strict'
import {createLocationReceiver} from './receiver.mjs'
const phonePassword='test-phone-password-not-a-real-secret-1234'
const ownerPassword='test-owner-password-not-a-real-secret-5678'
const auth=role=>`Basic ${Buffer.from(`${role}:${role==='phone'?phonePassword:ownerPassword}`).toString('base64')}`
test('receiver is authenticated, starts paused, retains latest only, and clears on pause',async()=>{
  const server=createLocationReceiver({phonePassword,ownerPassword})
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
  const base=`http://127.0.0.1:${server.address().port}`
  const call=(route,role,body,extra={})=>fetch(base+route,{method:body?'POST':'GET',headers:{...(role?{authorization:auth(role)}:{}),'content-type':'application/json',...extra},...(body?{body:JSON.stringify(body)}:{})})
  try {
    assert.equal((await call('/location/current')).status,401)
    assert.equal((await call('/location/current','phone')).status,403)
    assert.equal((await call('/location/control','phone',{action:'enable'})).status,403)
    const sample={_type:'location',lat:42,lon:-71,acc:10,tst:Date.now()/1000}
    assert.equal((await call('/location/update','owner',sample)).status,403)
    assert.equal((await call('/location/update','phone',sample)).status,200)
    assert.equal((await(await call('/location/current','owner')).json()).location,null)
    assert.equal((await call('/location/control','owner',{action:'enable'})).status,200)
    assert.deepEqual(await(await call('/location/update','phone',sample)).json(),[])
    assert.equal((await call('/location/current','owner',null,{origin:'https://untrusted.example'})).status,403)
    const state=await(await call('/location/current','owner')).json()
    assert.equal(state.location.latitude,42);assert.equal(state.history,undefined)
    assert.equal((await call('/location/update','phone',{...sample,lat:100})).status,400)
    assert.equal((await call('/location/update','phone',{padding:'x'.repeat(5000)})).status,413)
    assert.equal((await call('/location/update','phone',sample,{'content-type':'application/json-malformed'})).status,415)
    assert.equal((await call('/location/update','phone',{_type:'status',battery:50})).status,200)
    assert.equal((await call('/location/update','phone',{...sample,tst:1})).status,200)
    assert.equal((await(await call('/location/current','owner')).json()).location.latitude,42)
    await call('/location/control','owner',{action:'pause'})
    assert.equal((await(await call('/location/current','owner')).json()).location,null)
  } finally {server.closeAllConnections();await new Promise(resolve=>server.close(resolve))}
})
test('receiver refuses weak or shared credentials',()=>{
  assert.throws(()=>createLocationReceiver({phonePassword:'short',ownerPassword}))
  assert.throws(()=>createLocationReceiver({phonePassword,ownerPassword:phonePassword}))
})
