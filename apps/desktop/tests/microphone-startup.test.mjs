import test from 'node:test'
import assert from 'node:assert/strict'

test('shared microphone deduplicates opening and retains mute during permission wait',async()=>{
  const descriptor=Object.getOwnPropertyDescriptor(globalThis,'navigator')
  let release,calls=0
  const track={enabled:true,readyState:'live',stop(){}}
  const microphone={getAudioTracks:()=>[track]}
  Object.defineProperty(globalThis,'navigator',{configurable:true,value:{mediaDevices:{
    getUserMedia:()=>{calls++;return new Promise(resolve=>{release=resolve})},
    getSupportedConstraints:()=>({}),
  }}})
  try {
    const audio=await import('../src/lib/audio.ts?startup-test')
    const first=audio.getMic(),second=audio.getMic()
    assert.equal(calls,1)
    audio.setMicMuted(true)
    release(microphone)
    assert.equal(await first,microphone)
    assert.equal(await second,microphone)
    assert.equal(track.enabled,false)
    audio.setMicMuted(false)
    assert.equal(track.enabled,true)
    await audio.getMic();assert.equal(calls,1)
  } finally {
    if(descriptor)Object.defineProperty(globalThis,'navigator',descriptor)
    else delete globalThis.navigator
  }
})

test('permission failure can retry and ended microphone tracks are not reused',async()=>{
  const descriptor=Object.getOwnPropertyDescriptor(globalThis,'navigator')
  let calls=0
  const track={enabled:true,readyState:'live',stop(){}}
  const first={getAudioTracks:()=>[track]}
  const replacementTrack={enabled:true,readyState:'live',stop(){}}
  const replacement={getAudioTracks:()=>[replacementTrack]}
  Object.defineProperty(globalThis,'navigator',{configurable:true,value:{mediaDevices:{
    getUserMedia:async()=>{calls++;if(calls===1)throw new Error('permission denied');return calls===2?first:replacement},
    getSupportedConstraints:()=>({}),
  }}})
  try {
    const audio=await import('../src/lib/audio.ts?recovery-test')
    await assert.rejects(audio.getMic(),/permission denied/)
    assert.equal(await audio.getMic(),first)
    track.readyState='ended';audio.setMicMuted(true)
    assert.equal(await audio.getMic(),replacement)
    assert.equal(replacementTrack.enabled,false)
    assert.equal(calls,3)
    assert.equal(await audio.getMic(),replacement)
    assert.equal(calls,3)
  } finally {
    if(descriptor)Object.defineProperty(globalThis,'navigator',descriptor)
    else delete globalThis.navigator
  }
})
