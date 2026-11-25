import test from 'node:test'
import assert from 'node:assert/strict'
import {join} from 'node:path'
import {sttWorkerScript} from '../bridge/whisper.mjs'
test('packaged speech passes a physical suite script to Python, preserving source and legacy paths',()=>{
 const suite='C:/Program Files/Nori/resources/NoriSuite'
 for(const parakeet of [true,false]){
  const name=parakeet?'parakeet_stt.py':'whisper_stt.py'
  assert.equal(sttWorkerScript('C:/Program Files/Nori/resources/app.asar/bridge',suite,parakeet),join(suite,'apps','desktop','bridge',name))
  assert.equal(sttWorkerScript('C:/Nori/apps/desktop/bridge',suite,parakeet),join('C:/Nori/apps/desktop/bridge',name))
 }
})
