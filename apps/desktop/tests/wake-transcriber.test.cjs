const test=require('node:test')
const assert=require('node:assert/strict')
const {resolve}=require('node:path')
const {startWakeTranscriber}=require('../desktop/wake-transcriber.cjs')
test('actual offline warm client rejects bad/concurrent requests and confirms owned exit',
  {timeout:45000},async()=>{
    const worker=await startWakeTranscriber(resolve(__dirname,'../../..'))
    try{
      for(const pcm of [null,Buffer.alloc(0),Buffer.alloc(1),Buffer.alloc(384002)])
        await assert.rejects(worker.transcribe(pcm),/PCM bound/)
      const first=worker.transcribe(Buffer.alloc(32000))
      await assert.rejects(worker.transcribe(Buffer.alloc(32000)),/busy/)
      assert.equal(await first,'')
      assert.equal(await worker.transcribe(Buffer.alloc(32000)),'')
    }finally{assert.equal(await worker.stop(),true)}
    assert.equal(await worker.stop(),true)
    await assert.rejects(worker.transcribe(Buffer.alloc(32000)),/unavailable/)
  })
