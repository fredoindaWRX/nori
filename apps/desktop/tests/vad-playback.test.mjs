import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import ts from 'typescript'

test('actual VAD blocks Strict recording, preserves Standard interruption, and closes on stop',async()=>{
  const names=['AudioContext','MediaRecorder','requestAnimationFrame','cancelAnimationFrame','performance','__noriVadFixture']
  const original=new Map(names.map(name=>[name,Object.getOwnPropertyDescriptor(globalThis,name)]))
  let clock=1000,id=0,starts=0,ends=0,closed=0,disconnected=0,recorders=0
  const frames=new Map(),fixture={strict:true,playing:true}
  const trackListeners=new Set()
  const track={readyState:'live',addEventListener(_type,listener){trackListeners.add(listener)},removeEventListener(_type,listener){trackListeners.delete(listener)},end(){this.readyState='ended';for(const listener of [...trackListeners])listener()}}
  fixture.stream={getAudioTracks:()=>[track]}
  const define=(name,value)=>Object.defineProperty(globalThis,name,{configurable:true,value})
  define('__noriVadFixture',fixture)
  define('performance',{now:()=>clock})
  define('requestAnimationFrame',callback=>{frames.set(++id,callback);return id})
  define('cancelAnimationFrame',key=>frames.delete(key))
  define('MediaRecorder',class {
    static isTypeSupported(){return true}
    constructor(){recorders++;this.state='inactive';this.mimeType='audio/webm'}
    start(){this.state='recording'}
    stop(){this.state='inactive';this.onstop?.()}
  })
  define('AudioContext',class {
    resume(){return Promise.resolve()}
    close(){closed++;return Promise.resolve()}
    createMediaStreamSource(){return {connect(){},disconnect(){disconnected++}}}
    createAnalyser(){return {getFloatTimeDomainData:buffer=>buffer.fill(.5)}}
  })
  let detector
  try {
    // Transpile the real implementation, replacing only its hardware/config inputs.
    const options={compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}
    const policy=ts.transpileModule(readFileSync(new URL('../src/lib/noise-guard.ts',import.meta.url),'utf8'),options).outputText
    const policyUrl='data:text/javascript;base64,'+Buffer.from(policy).toString('base64')
    const source=readFileSync(new URL('../src/lib/vad.ts',import.meta.url),'utf8')
      .replace("import { echoStrict, getMic } from './audio'",'const echoStrict=()=>globalThis.__noriVadFixture.strict; const getMic=async()=>globalThis.__noriVadFixture.stream;')
      .replace("import { blockDuringPlayback } from './noise-guard'",`import { blockDuringPlayback } from '${policyUrl}'`)
      .replace("import { onAudioTrackEnded } from './audio-track-recovery'",`const onAudioTrackEnded=(track,callback)=>{let active=true;const ended=()=>{if(!active)return;active=false;track.removeEventListener('ended',ended);callback()};if(track.readyState==='ended'){ended();return()=>{active=false}}track.addEventListener('ended',ended,{once:true});return()=>{active=false;track.removeEventListener('ended',ended)}}`)
    const code=ts.transpileModule(source,options).outputText
    const {startVad}=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'))
    const errors=[],runtimeFailures=[]
    detector=await startVad({playbackActive:()=>fixture.playing,onStart:()=>starts++,onEnd:()=>ends++,onLevel(){},onError:message=>errors.push(message),onRuntimeFailure:failure=>runtimeFailures.push(failure)})
    const frame=()=>{clock+=200;const [key,callback]=frames.entries().next().value;frames.delete(key);callback()}
    for(let index=0;index<4;index++)frame()
    assert.equal(recorders,0);assert.equal(starts,0)
    fixture.strict=false;detector.setGuard(true)
    frame();frame()
    assert.equal(recorders,1);assert.equal(starts,1)
    fixture.strict=true;frame()
    assert.equal(detector.meter().speaking,false)
    assert.equal(ends,0,'Strict must discard rather than deliver captured playback')
    track.end()
    assert.deepEqual(runtimeFailures,['transient'])
    assert.match(errors[0],/microphone connection ended/i)
    detector.stop()
    detector.stop()
    assert.equal(detector.live(),false);assert.equal(frames.size,0)
    assert.equal(closed,1);assert.equal(disconnected,1)
  } finally {
    if(detector?.live())detector.stop()
    for(const [name,descriptor] of original){if(descriptor)Object.defineProperty(globalThis,name,descriptor);else delete globalThis[name]}
  }
})
