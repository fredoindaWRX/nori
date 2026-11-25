import test from 'node:test'
import assert from 'node:assert/strict'
import { prepareVoiceInput } from '../src/lib/voice-startup.ts'

test('offline local speech completes without opening or waiting for microphone', async () => {
  let opened=0
  const result=await prepareVoiceInput({probe:async()=>({stt:false,tts:false}),
    startAnalyser:()=>{opened++;return new Promise(()=>{})},onAnalyserFailure:()=>assert.fail('not attempted')})
  assert.deepEqual(result,{stt:false,tts:false});assert.equal(opened,0)
})
test('microphone startup waits for confirmed local speech capability', async () => {
  const events=[];let confirm
  const pending=prepareVoiceInput({probe:()=>{events.push('probe');return new Promise(resolve=>{confirm=resolve})},
    startAnalyser:async()=>{events.push('microphone')},onAnalyserFailure:()=>assert.fail('unexpected')})
  assert.deepEqual(events,['probe'])
  confirm({stt:true,tts:false});assert.deepEqual(await pending,{stt:true,tts:false})
  assert.deepEqual(events,['probe','microphone'])
})
test('analyser failure is reported without losing the local capability result', async () => {
  let failures=0
  const result=await prepareVoiceInput({probe:async()=>({stt:true,tts:true}),
    startAnalyser:async()=>{throw Error('synthetic permission denial')},onAnalyserFailure:()=>{failures++}})
  assert.equal(failures,1);assert.deepEqual(result,{stt:true,tts:true})
})
