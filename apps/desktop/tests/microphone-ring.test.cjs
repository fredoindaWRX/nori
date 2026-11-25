const test=require('node:test')
const assert=require('node:assert/strict')
const {createMicrophoneRing}=require('../desktop/microphone-ring.cjs')
test('rolling PCM window stays bounded and preserves overlap across wrap',()=>{
  const ring=createMicrophoneRing(),blocks=[]
  for(let i=0;i<10;i++){const block=Buffer.alloc(32000,i);blocks.push(block);ring.append(block)}
  assert.equal(ring.total(),320000)
  const all=Buffer.concat(blocks)
  assert.deepEqual(ring.snapshot(128000),all.subarray(-128000))
  assert.deepEqual(ring.snapshot(96000),all.subarray(-96000))
  assert.equal(ring.snapshot().length,96000)
  ring.clear();assert.equal(ring.snapshot().length,0)
  for(const bytes of [0,1,128002,true])assert.throws(()=>ring.snapshot(bytes))
  for(const pcm of [null,Buffer.alloc(1),Buffer.alloc(65538)])assert.throws(()=>ring.append(pcm))
})
