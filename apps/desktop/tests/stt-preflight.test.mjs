import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {dirname,join} from 'node:path'
import {sttPreflight} from '../scripts/stt-preflight.mjs'
test('STT payload presence requires nonempty launcher, license, model and dependencies but never claims runtime acceptance',()=>{
  const root=mkdtempSync(join(tmpdir(),'nori-stt-preflight-'))
  try{
    const initial=sttPreflight(root)
    assert.equal(initial.payloadPresent,false)
    assert.ok(initial.missing.includes('runtime/stt/launch_worker.py'))
    assert.ok(initial.missing.includes('models/voice/whisper-base.en/LICENSE'))
    for(const name of initial.missing){const path=join(root,name);mkdirSync(dirname(path),{recursive:true});writeFileSync(path,'fixture')}
    const present=sttPreflight(root)
    assert.equal(present.payloadPresent,true)
    assert.equal(present.runtimeVerified,false)
    assert.equal(present.microphoneVerified,false)
    assert.equal(present.wakeWordVerified,false)
    writeFileSync(join(root,'models/voice/whisper-base.en/model.bin'),'')
    assert.equal(sttPreflight(root).payloadPresent,false)
  }finally{rmSync(root,{recursive:true,force:true})}
})
