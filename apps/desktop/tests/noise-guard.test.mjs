import test from 'node:test'
import assert from 'node:assert/strict'
import {blockDuringPlayback} from '../src/lib/noise-guard.ts'
import {readFileSync} from 'node:fs'

test('Strict blocks assistant playback only; Standard retains barge-in',()=>{
  assert.equal(blockDuringPlayback(true,true),true)
  for(const [strict,playing] of [[false,true],[true,false],[false,false]])
    assert.equal(blockDuringPlayback(strict,playing),false)
})

test('voice segment callbacks independently recheck stop and Strict playback',()=>{
  const source=readFileSync(new URL('../src/lib/voice.ts',import.meta.url),'utf8')
  for(const marker of ['onStart: () => {','onEnd: (blob) => {']){
    const index=source.indexOf(marker,source.indexOf('vad = await startVad'))
    assert.ok(index>=0)
    assert.match(source.slice(index,index+230),/!lifetime.active\(\) \|\| blockDuringPlayback\(echoStrict\(\), Boolean\(speakingNow\(\)\)\)/)
  }
})
test('playback gate is connected to VAD before microphone energy processing',()=>{
  const source=readFileSync(new URL('../src/lib/vad.ts',import.meta.url),'utf8')
  const gate=source.indexOf('if (blockDuringPlayback(')
  assert.ok(gate>=0&&gate<source.indexOf('const energy = rms()',gate))
  assert.match(source,/playbackActive\?: \(\) => boolean/)
})
