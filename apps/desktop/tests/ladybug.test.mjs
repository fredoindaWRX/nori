import test from 'node:test'
import assert from 'node:assert/strict'
import { createLadybug } from '../bridge/ladybug.mjs'
test('Ladybug distinguishes provider availability from completed generation and unsupported editing', async () => {
  const status=await createLadybug({health:async()=>true}).status()
  assert.equal(status.generation,'provider-reachable');assert.equal(status.generated,false)
  assert.equal(status.maskedFill,'not-implemented')
})
test('Ladybug validates before dispatch and propagates provider failures', async () => {
  let calls=0
  const ladybug=createLadybug({generate:async()=>{calls++;throw Error('provider stopped')}})
  await assert.rejects(ladybug.generate({prompt:'test',mask:'unsafe assumption'}),/Unsupported/)
  await assert.rejects(ladybug.generate({prompt:'test',width:99999}),/dimensions/)
  assert.equal(calls,0)
  await assert.rejects(ladybug.generate({prompt:'test'}),/provider stopped/)
})
test('Ladybug returns an image receipt without claiming display or persistence', async () => {
  const ladybug=createLadybug({generate:async()=>({mimeType:'image/png',data:'aW1hZ2U='})})
  const result=await ladybug.generate({prompt:'A red ladybug on a leaf'})
  assert.equal(result.generated,true);assert.equal(result.displayed,false);assert.equal(result.localOnly,true)
})
