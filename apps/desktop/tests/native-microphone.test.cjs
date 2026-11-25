const test=require('node:test')
const assert=require('node:assert/strict')
const {parseMicrophoneOutput,captureNativeMicrophone}=require('../desktop/native-microphone.cjs')
const header=()=>Buffer.from(JSON.stringify({schema:1,backend:'nori-wasapi',rate:16000,channels:1,format:'s16le'})+'\n')
const packet=bytes=>{const size=Buffer.alloc(4);size.writeUInt32LE(bytes.length);return Buffer.concat([size,bytes])}
const end=Buffer.alloc(4)
test('bounded microphone protocol preserves PCM and demands termination',()=>{
  const pcm=Buffer.from([0,1,2,3])
  const output=Buffer.concat([header(),packet(pcm),end])
  const parsed=parseMicrophoneOutput(output)
  assert.deepEqual(parsed.pcm,pcm);assert.equal(parsed.rate,16000)
  for(const bad of [output.subarray(0,-1),Buffer.concat([output,Buffer.from([1])]),
    Buffer.concat([header(),end]),Buffer.concat([header(),packet(Buffer.alloc(3)),end]),
    Buffer.concat([header(),packet(Buffer.alloc(65538)),end]),Buffer.alloc(400001),
    Buffer.from('garbage\n'),Buffer.concat([Buffer.from('{}\n'),packet(pcm),end])])
    assert.throws(()=>parseMicrophoneOutput(bad))
})
test('invalid/cancelled capture refuses before any microphone process',async()=>{
  for(const duration of [0,-1,10001,1.2,'1',true])
    await assert.rejects(captureNativeMicrophone('missing-root',{duration}),/duration/)
  const controller=new AbortController();controller.abort()
  await assert.rejects(captureNativeMicrophone('missing-root',{signal:controller.signal}),/before launch/)
})
