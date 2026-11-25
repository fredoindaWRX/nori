import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {selectBuiltCandidate,nativePackageArguments} from '../scripts/package-native-desktop.mjs'
test('candidate builds preserve current selection unless explicitly selected',()=>{
  const root=mkdtempSync(join(tmpdir(),'nori-select-'))
  try{
    mkdirSync(join(root,'release'))
    const pointer=join(root,'release/current-desktop.txt')
    writeFileSync(pointer,'known-working\n')
    assert.equal(selectBuiltCandidate(root,'experimental'),false)
    assert.equal(readFileSync(pointer,'utf8'),'known-working\n')
    assert.throws(()=>selectBuiltCandidate(root,'experimental',true),/missing/)
    assert.equal(readFileSync(pointer,'utf8'),'known-working\n')
    mkdirSync(join(root,'release/native-desktop-experimental/win-unpacked'),{recursive:true})
    writeFileSync(join(root,'release/native-desktop-experimental/win-unpacked/Nori.exe'),'fixture')
    assert.equal(selectBuiltCandidate(root,'experimental',true),true)
    assert.equal(readFileSync(pointer,'utf8'),'experimental\n')
    assert.throws(()=>selectBuiltCandidate(root,'../escape',true),/Unsafe/)
    assert.throws(()=>selectBuiltCandidate(root,'experimental','true'),/boolean/)
  }finally{rmSync(root,{recursive:true,force:true})}
})
test('CLI selection is opt-in, unique and never accepts a string boolean',()=>{
  assert.deepEqual(nativePackageArguments(['--candidate=test','--select-current']),{candidate:'test',selectCurrent:true})
  assert.deepEqual(nativePackageArguments(['--candidate=test']),{candidate:'test'})
  assert.throws(()=>nativePackageArguments(['--select-current','--select-current']),/unique/)
  assert.throws(()=>nativePackageArguments(['--select-current=true']),/unique safe/)
})
