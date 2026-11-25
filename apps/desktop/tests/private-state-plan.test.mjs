import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,mkdirSync,writeFileSync,rmSync,rmdirSync,symlinkSync,readFileSync} from 'node:fs'
import {join,dirname} from 'node:path'
import {tmpdir} from 'node:os'
import {privateStatePlan,verifyPrivateStatePlan} from '../scripts/private-state-plan.mjs'
function fixture() {
  const root=mkdtempSync(join(tmpdir(),'nori-state-plan-')),source=join(root,'old-profile')
  mkdirSync(source)
  const put=name=>{const path=join(source,name);mkdirSync(dirname(path),{recursive:true});writeFileSync(path,'synthetic fixture')}
  return {root,source,put,cleanup:()=>rmSync(root,{recursive:true,force:true})}
}

test('cache and model names on regular files do not silently exclude durable data',()=>{
  const f=fixture()
  try{
    for(const name of ['Cache','Code Cache','GPUCache','models'])f.put(name)
    const plan=privateStatePlan(f.root,f.source)
    assert.deepEqual(plan.files.map(file=>file.path),['Cache','Code Cache','GPUCache','models'])
    assert.deepEqual(plan.excludedCaches,[])
    assert.deepEqual(plan.separateComponents,[])
    assert.equal(verifyPrivateStatePlan(f.root,plan).metadataMatches,true)
    for(const name of ['Cache','Code Cache','GPUCache','models'])
      assert.equal(readFileSync(join(f.source,name),'utf8'),'synthetic fixture')
  }finally{f.cleanup()}
})

test('directory disguised as an ownership record is refused rather than omitted',()=>{
  const f=fixture()
  try{
    f.put('.nori-state-owner.json/durable.json')
    assert.throws(()=>privateStatePlan(f.root,f.source),/Invalid source ownership record/)
    assert.equal(readFileSync(join(f.source,'.nori-state-owner.json/durable.json'),'utf8'),'synthetic fixture')
  }finally{f.cleanup()}
})

test('desktop migration excludes the temporary ownership record without deleting it',()=>{
  const f=fixture()
  try{
    f.put('.nori-state-owner.json')
    f.put('settings/profile.json')
    const plan=privateStatePlan(f.root,f.source,{component:'desktop'})
    assert.deepEqual(plan.files.map(file=>file.path),['settings/profile.json'])
    assert.equal(plan.separateComponents[0].path,'.nori-state-owner.json')
    assert.equal(readFileSync(join(f.source,'.nori-state-owner.json'),'utf8'),'synthetic fixture')
  }finally{f.cleanup()}
})

test('Core migration has its own protected destination and preserves private token inventory',()=>{
  const f=fixture()
  try{
    f.put('private/letta-token')
    f.put('memory/mirror.json')
    f.put('Cache/durable-core-state.json')
    f.put('models/core-model-registry.json')
    const plan=privateStatePlan(f.root,f.source,{component:'core'})
    assert.equal(plan.destination,join(f.root,'state/private/core'))
    assert.equal(plan.component,'core')
    assert.equal(plan.files.length,4)
    assert.deepEqual(plan.excludedCaches,[])
    assert.deepEqual(plan.separateComponents,[])
    assert.equal(verifyPrivateStatePlan(f.root,plan).metadataMatches,true)
    assert.throws(()=>privateStatePlan(f.root,f.source,{component:'../models'}),/Unknown private-state component/)
    assert.throws(()=>verifyPrivateStatePlan(f.root,{...plan,component:'desktop'}),/changed after planning/)
  }finally{f.cleanup()}
})

test('migration freshness rejects changed contents metadata and new durable directories',()=>{
  const f=fixture()
  try {
    f.put('settings/profile.json')
    const plan=privateStatePlan(f.root,f.source)
    assert.deepEqual(verifyPrivateStatePlan(f.root,plan),{
      metadataMatches:true,copyAuthorized:false,requiresQuiescence:true,requiresContentHashes:true})
    writeFileSync(join(f.source,'settings/profile.json'),'different-size fixture')
    assert.throws(()=>verifyPrivateStatePlan(f.root,plan),/changed after planning/)
    const updated=privateStatePlan(f.root,f.source)
    mkdirSync(join(f.source,'new-durable-folder'))
    assert.throws(()=>verifyPrivateStatePlan(f.root,updated),/changed after planning/)
    assert.throws(()=>verifyPrivateStatePlan(f.root,{...updated,destination:join(f.root,'outside')}),/changed after planning/)
  } finally {f.cleanup()}
})
test('private migration plan preserves durable and unknown files without copying or reading contents',()=>{
  const f=fixture()
  try {
    for(const name of ['secrets/council-token','location-private/credentials.clixml','Local Storage/state.db',
      'settings/settings.json','unknown-new-feature/state.bin','Cache/transient','models/weights.gguf']) f.put(name)
    const plan=privateStatePlan(f.root,f.source)
    assert.equal(plan.files.length,5)
    assert.deepEqual(plan.excludedCaches,['Cache'])
    assert.equal(plan.separateComponents[0].path,'models')
    assert.equal(plan.requiresProtectedAcl,true)
    assert.equal(plan.requiresQuiescence,true)
    assert.equal(plan.migrationApplied,false)
    assert.equal(plan.sameWindowsAccountRequired,true)
    assert.ok(plan.directories.includes('location-private'))
    assert.equal(readFileSync(join(f.source,'secrets/council-token'),'utf8'),'synthetic fixture')
  } finally {f.cleanup()}
})

test('migration inventory preserves empty durable directories and rejects source overlap',()=>{
  const f=fixture()
  try {
    mkdirSync(join(f.source,'Attachments/empty-session'),{recursive:true})
    const plan=privateStatePlan(f.root,f.source)
    assert.deepEqual(plan.directories,['Attachments','Attachments/empty-session'])
    assert.equal(plan.files.length,0)
    assert.throws(()=>privateStatePlan(f.root,f.root),/overlaps legacy state/)
  } finally {f.cleanup()}
})
test('migration planning preserves occupied destination and refuses linked source files',()=>{
  const f=fixture()
  try {
    mkdirSync(join(f.root,'state/private/desktop'),{recursive:true})
    assert.throws(()=>privateStatePlan(f.root,f.source),/destination preserved/)
    rmdirSync(join(f.root,'state/private/desktop')) // Exact empty fixture directory.
    const external=join(f.root,'external');mkdirSync(external)
    symlinkSync(external,join(f.source,'linked'),'junction')
    assert.throws(()=>privateStatePlan(f.root,f.source),/Linked private-state/)
  } finally {f.cleanup()}
})
