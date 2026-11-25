import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {whisperSource,whisperFiles} from '../scripts/whisper-payload.mjs'
test('Whisper payload resolves a complete cached snapshot and rejects unsafe refs',()=>{
  const root=mkdtempSync(join(tmpdir(),'nori-whisper-cache-test-'))
  try{
    const repo=join(root,'models--Systran--faster-whisper-base.en'),revision='a'.repeat(40)
    const snapshot=join(repo,'snapshots',revision)
    mkdirSync(join(repo,'refs'),{recursive:true});mkdirSync(snapshot,{recursive:true})
    writeFileSync(join(repo,'refs','main'),revision)
    assert.throws(()=>whisperSource(root),/prerequisites missing/)
    for(const name of whisperFiles)writeFileSync(join(snapshot,name),'fixture')
    assert.equal(whisperSource(root),snapshot)
    assert.equal(whisperSource(root,snapshot),snapshot)
    writeFileSync(join(repo,'refs','main'),'../../outside')
    assert.throws(()=>whisperSource(root),/Invalid cached Whisper revision/)
  }finally{rmSync(root,{recursive:true,force:true})}
})
