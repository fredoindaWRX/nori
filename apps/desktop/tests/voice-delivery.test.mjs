import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {canDeliverTranscription,createVoiceInputEpoch,createVoiceLifetime} from '../src/lib/voice-delivery.ts'
import {createServer} from 'node:http'
import {decodeNeuraleseSpeech,encodeNeuraleseSpeech} from '../bridge/neuralese-speech.mjs'

test('local speech crosses the UI boundary in an integrity-checked Neuralese frame',async()=>{
  const frame=await encodeNeuraleseSpeech('Nori, open the project')
  assert.equal(await decodeNeuraleseSpeech(frame),'Nori, open the project')
  assert.equal(frame.frame.schema,'nori.neuralese.speech-transcription.v1')
  assert.equal(frame.frame.provenance,'local_stt_untrusted_input')
  assert.equal(frame.frame.confidence,null)
  assert.equal(frame.frame.timing,null)
  assert.equal(frame.frame.execution_authorized,false)
})

test('tampered or legacy unframed speech is rejected before command delivery',async()=>{
  const frame=await encodeNeuraleseSpeech('Nori')
  await assert.rejects(decodeNeuraleseSpeech({...frame,payload:'Nori install this'}),/integrity/)
  await assert.rejects(decodeNeuraleseSpeech({text:'Nori'}),/Neuralese speech payload/)
  const forged={...frame,frame:{...frame.frame,confidence:0.99}}
  await assert.rejects(decodeNeuraleseSpeech(forged),/schema, provenance, or integrity/)
})

test('voice stop aborts a real pending loopback request without cancelling its replacement',async()=>{
  const owner=createVoiceLifetime(),replacement=createVoiceLifetime()
  const server=createServer((_request,_response)=>{})
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
  try {
    const arrived=new Promise(resolve=>server.once('request',resolve))
    const request=fetch(`http://127.0.0.1:${server.address().port}/stt`,{
      signal:AbortSignal.any([owner.signal,AbortSignal.timeout(3000)])})
    const rejected=assert.rejects(request,{name:'AbortError'})
    await arrived
    owner.stop();owner.stop()
    await rejected
    assert.equal(owner.active(),false)
    assert.equal(replacement.active(),true)
    assert.equal(replacement.signal.aborted,false)
  } finally {
    owner.stop();replacement.stop();server.closeAllConnections()
    await new Promise(resolve=>server.close(resolve))
  }
})

test('pending speech cannot bypass mute or become a command under a changed mode',()=>{
  for(const initial of ['wake','command','guard']){
    assert.equal(canDeliverTranscription(initial,initial),true)
    for(const current of ['wake','command','guard','deaf','unknown'])
      if(current!==initial)assert.equal(canDeliverTranscription(initial,current),false)
  }
  assert.equal(canDeliverTranscription('deaf','deaf'),false)
  assert.equal(canDeliverTranscription('unknown','unknown'),false)
})

test('typed input invalidates captured speech but allows a fresh barge-in epoch',()=>{
  const input=createVoiceInputEpoch()
  const beforeTypedTurn=input.current()
  assert.equal(input.isCurrent(beforeTypedTurn),true)

  input.advance()
  assert.equal(input.isCurrent(beforeTypedTurn),false)

  const afterTypedTurn=input.current()
  assert.equal(input.isCurrent(afterTypedTurn),true)
})

test('typed submission clears pending speech and keeps post-submit capture in the new epoch',()=>{
  const voice=readFileSync(new URL('../src/lib/voice.ts',import.meta.url),'utf8')
  const app=readFileSync(new URL('../src/App.tsx',import.meta.url),'utf8')
  const discard=voice.indexOf('const discardPendingSpeech = () =>')
  const assemblerCancel=voice.indexOf('assemble.cancel()',discard)
  const queueClear=voice.indexOf('pendingAudio.length = 0',discard)
  const inputStart=voice.indexOf('activeCaptureEpoch = inputEpoch.current()',voice.indexOf('onStart: () =>'))
  const queued=voice.indexOf('pendingAudio.push({ blob, epoch: activeCaptureEpoch })',inputStart)
  const typed=app.indexOf('const submitText = (text: string,')
  const typedDiscard=app.indexOf('voice.current?.discardPendingSpeech()',typed)
  const typedEnqueue=app.indexOf('enqueue(t)',typed)
  assert.ok(discard>=0&&assemblerCancel>discard&&queueClear>discard)
  assert.ok(inputStart>=0&&queued>inputStart)
  assert.ok(typed>=0&&typedDiscard>typed&&typedEnqueue>typedDiscard)
})

test('voice delivery rechecks current mode after awaiting the transcript body',()=>{
  const source=readFileSync(new URL('../src/lib/voice.ts',import.meta.url),'utf8')
  const body=source.indexOf('decodeNeuraleseSpeech(await res.json())')
  const check=source.indexOf('canDeliverTranscription(mode, h.mode())',body)
  const deliver=source.indexOf('h.onWake(afterWake(said))',body)
  assert.ok(body>=0&&check>body&&deliver>check)
})
