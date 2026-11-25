import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,mkdirSync,writeFileSync,copyFileSync,rmSync,utimesSync,symlinkSync,unlinkSync} from 'node:fs'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {createRequire} from 'node:module'
const {acquireStateOwner}=createRequire(import.meta.url)('../desktop/state-owner.cjs')
import {privateStatePlan} from '../scripts/private-state-plan.mjs'
import {privateStateSnapshot,verifyPrivateStateCopy,verifyPrivateStateSource} from '../scripts/private-state-integrity.mjs'
test('copy verifier refuses linked parent even when leaf contents exactly match',()=>{
  const root=mkdtempSync(join(tmpdir(),'nori-copy-ancestry-'))
  const source=join(root,'old'),actual=join(root,'actual'),link=join(root,'redirect')
  mkdirSync(source);mkdirSync(actual);mkdirSync(join(actual,'copy'))
  try{
    const snapshot=privateStateSnapshot(root,privateStatePlan(root,source))
    symlinkSync(actual,link,process.platform==='win32'?'junction':'dir')
    assert.equal(verifyPrivateStateCopy(join(actual,'copy'),snapshot).contentMatches,true)
    assert.throws(()=>verifyPrivateStateCopy(join(link,'copy'),snapshot),/ancestry refused/)
    assert.throws(()=>verifyPrivateStateCopy('relative-copy',snapshot),/Absolute/)
  }finally{
    try{unlinkSync(link)}finally{rmSync(root,{recursive:true,force:true})}
  }
})
test('copy verification excludes only an exact held destination migration record',()=>{
  const root=mkdtempSync(join(tmpdir(),'nori-private-destination-owner-'))
  const source=join(root,'old'),copy=join(root,'copy')
  mkdirSync(source);mkdirSync(copy)
  let owner,other
  try{
    const snapshot=privateStateSnapshot(root,privateStatePlan(root,source))
    owner=acquireStateOwner(copy,{purpose:'migration'})
    assert.throws(()=>acquireStateOwner(copy,{purpose:'core'}),/EEXIST/)
    assert.throws(()=>verifyPrivateStateCopy(copy,snapshot),/inventory differs/)
    assert.equal(verifyPrivateStateCopy(copy,snapshot,{destinationOwner:owner}).contentMatches,true)
    other=acquireStateOwner(source,{purpose:'migration'})
    assert.throws(()=>verifyPrivateStateCopy(copy,snapshot,{destinationOwner:other}),/ownership mismatch/)
    owner.release()
    assert.throws(()=>verifyPrivateStateCopy(copy,snapshot,{destinationOwner:owner}),/already released/)
    writeFileSync(join(copy,'.nori-state-owner.json'),'foreign fixture record')
    assert.throws(()=>verifyPrivateStateCopy(copy,snapshot),/inventory differs/)
  }finally{try{other?.release()}finally{rmSync(root,{recursive:true,force:true})}}
})

test('source content verification rejects a same-size rewrite even with restored timestamp',()=>{
  const root=mkdtempSync(join(tmpdir(),'nori-private-source-')),source=join(root,'old')
  mkdirSync(source)
  try{
    const file=join(source,'memory.json')
    writeFileSync(file,'original')
    // Whole-second timestamp is exactly representable on Windows and Unix.
    const timestamp=new Date('2026-01-01T00:00:00Z');utimesSync(file,timestamp,timestamp)
    const plan=privateStatePlan(root,source),snapshot=privateStateSnapshot(root,plan)
    assert.equal(verifyPrivateStateSource(root,plan,snapshot).sourceContentMatches,true)
    writeFileSync(file,'modified');utimesSync(file,timestamp,timestamp)
    assert.throws(()=>verifyPrivateStateSource(root,plan,snapshot),/integrity mismatch/)
  }finally{rmSync(root,{recursive:true,force:true})}
})

test('private copy evidence detects same-size corruption and extra entries',()=>{
  const root=mkdtempSync(join(tmpdir(),'nori-private-integrity-'))
  const source=join(root,'old'),copy=join(root,'copy')
  mkdirSync(source);mkdirSync(copy)
  try{
    writeFileSync(join(source,'settings.json'),'original')
    mkdirSync(join(source,'empty'))
    const snapshot=privateStateSnapshot(root,privateStatePlan(root,source))
    copyFileSync(join(source,'settings.json'),join(copy,'settings.json'));mkdirSync(join(copy,'empty'))
    assert.equal(verifyPrivateStateCopy(copy,snapshot).contentMatches,true)
    assert.equal(verifyPrivateStateCopy(copy,snapshot).activationAuthorized,false)
    writeFileSync(join(copy,'settings.json'),'modified')
    assert.throws(()=>verifyPrivateStateCopy(copy,snapshot),/integrity mismatch/)
    copyFileSync(join(source,'settings.json'),join(copy,'settings.json'))
    writeFileSync(join(copy,'unexpected'),'fixture')
    assert.throws(()=>verifyPrivateStateCopy(copy,snapshot),/inventory differs/)
  }finally{rmSync(root,{recursive:true,force:true})}
})
