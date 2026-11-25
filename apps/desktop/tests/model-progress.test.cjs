const test=require('node:test')
const assert=require('node:assert/strict')
const {consumeModelProgress}=require('../desktop/model-progress.cjs')
function stream(...chunks){return new ReadableStream({start(controller){for(const chunk of chunks)controller.enqueue(new TextEncoder().encode(chunk));controller.close()}})}
test('model pull processes split records and a final success without newline',async()=>{
  const events=[]
  await consumeModelProgress(stream('{"status":"down','loading","completed":3}\n','{"status":"success"}'),event=>events.push(event))
  assert.equal(events.length,2);assert.equal(events[1].status,'success')
})
test('model pull rejects a truncated stream rather than claiming installation',async()=>{
  await assert.rejects(consumeModelProgress(stream('{"status":"downloading"}\n'),()=>{}),/before success/)
})
test('model pull reports a final error record without newline',async()=>{
  await assert.rejects(consumeModelProgress(stream('{"error":"disk full"}'),()=>{}),/disk full/)
})
test('model pull rejects oversized progress records',async()=>{
  await assert.rejects(consumeModelProgress(stream('x'.repeat(65537)),()=>{}),/too large/)
})
