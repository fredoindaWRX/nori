import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {createRequire} from 'node:module'
import {pathToFileURL} from 'node:url'
import ts from 'typescript'
test('new desktop session starts mic off and muting discards queued speech', async () => {
  const source=readFileSync(new URL('../src/store.ts',import.meta.url),'utf8').replaceAll('import.meta.env.DEV','false')
  const zustand=pathToFileURL(createRequire(import.meta.url).resolve('zustand')).href
  const code=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2023,module:ts.ModuleKind.ESNext}}).outputText.replace("from 'zustand'",`from '${zustand}'`)
  const {useStore}=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'))
  assert.equal(useStore.getState().muted,true)
  useStore.setState({queue:['unintended background conversation'],caption:'partial words'})
  useStore.getState().setMuted(true)
  assert.deepEqual(useStore.getState().queue,[])
  assert.equal(useStore.getState().caption,'')
  useStore.getState().setMuted(false)
  assert.equal(useStore.getState().muted,false)
  useStore.getState().setMuted(true)
})
test('microphone opened before renderer effects stays disabled until explicit unmute',async()=>{
  const descriptor=Object.getOwnPropertyDescriptor(globalThis,'navigator')
  const track={enabled:true,readyState:'live',stop(){}}
  Object.defineProperty(globalThis,'navigator',{configurable:true,value:{mediaDevices:{
    getUserMedia:async()=>({getAudioTracks:()=>[track]}),getSupportedConstraints:()=>({}),
  }}})
  try{
    const audio=await import('../src/lib/audio.ts?opt-in-regression')
    await audio.getMic();assert.equal(track.enabled,false)
    audio.setMicMuted(false);assert.equal(track.enabled,true)
    audio.setMicMuted(true);assert.equal(track.enabled,false)
  }finally{if(descriptor)Object.defineProperty(globalThis,'navigator',descriptor);else delete globalThis.navigator}
})
