import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,existsSync,symlinkSync,rmSync} from 'node:fs'
import {join,resolve} from 'node:path'
import {createHash} from 'node:crypto'
import {archiveGuardedReadiness,captureGuardedReadiness} from '../scripts/archive-guarded-readiness.mjs'
const hash=value=>createHash('sha256').update(value).digest('hex')
const fixtures=new Set()
function fixture(){
  const root=mkdtempSync(join(resolve(import.meta.dirname,'../../../verification'),'.native-readiness-archive-'))
  fixtures.add(root)
  const job=join(root,'.native-job-guardian-archive');mkdirSync(job)
  const state=join(root,'state');mkdirSync(state)
  const source=join(state,'desktop-readiness.json'),bytes='{"syntheticOnly":true}'
  writeFileSync(source,bytes,{flag:'wx'})
  return {root,job,state,source,bytes,options:{source,fixture:job,sha256:hash(bytes)}}
}
test.afterEach(()=>{for(const root of fixtures)rmSync(root,{recursive:true,force:true});fixtures.clear()})
test('exact prior readiness is recoverably archived without touching state, failure or ownership',()=>{
  const f=fixture()
  for(const name of ['desktop-failure.json','.nori-state-owner.json','.nori-state-guardian.json'])
    writeFileSync(join(f.state,name),'foreign-preserved')
  const archived=archiveGuardedReadiness(f.options)
  assert.equal(existsSync(f.source),false);assert.equal(readFileSync(archived.path,'utf8'),f.bytes)
  for(const name of ['desktop-failure.json','.nori-state-owner.json','.nori-state-guardian.json'])
    assert.equal(readFileSync(join(f.state,name),'utf8'),'foreign-preserved')
})
test('changed, oversized, wrong-name and linked readiness refuse without deleting source',()=>{
  for(const kind of ['changed','oversized','wrong-name','linked']){
    const f=fixture();let options=f.options
    if(kind==='changed')writeFileSync(f.source,'foreign replacement')
    if(kind==='oversized')writeFileSync(f.source,'x'.repeat(65537))
    if(kind==='wrong-name')options={...options,source:join(f.state,'desktop-failure.json')}
    if(kind==='linked'){
      const alias=join(f.root,'alias');symlinkSync(f.state,alias,process.platform==='win32'?'junction':'dir')
      options={...options,source:join(alias,'desktop-readiness.json')}
    }
    assert.throws(()=>archiveGuardedReadiness(options),/changed|bounded|Exact|Unlinked/)
    assert.equal(existsSync(f.source),true)
    assert.equal(existsSync(join(f.job,'prior-desktop-readiness.json')),false)
  }
})
test('existing foreign archive is not overwritten or used to authorize readiness removal',()=>{
  const f=fixture(),path=join(f.job,'prior-desktop-readiness.json')
  writeFileSync(path,'foreign archive',{flag:'wx'})
  assert.throws(()=>archiveGuardedReadiness(f.options),{code:'EEXIST'})
  assert.equal(readFileSync(path,'utf8'),'foreign archive');assert.equal(readFileSync(f.source,'utf8'),f.bytes)
})
test('captured readiness must match the actual owned acceptance, not just be valid JSON',()=>{
  const f=fixture()
  assert.equal(captureGuardedReadiness(f.source,{syntheticOnly:true}),hash(f.bytes))
  assert.throws(()=>captureGuardedReadiness(f.source,{syntheticOnly:false}),/replaced/)
  assert.equal(readFileSync(f.source,'utf8'),f.bytes)
})
