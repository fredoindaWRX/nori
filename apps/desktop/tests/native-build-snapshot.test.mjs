import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {dirname,join,resolve} from 'node:path'
import {captureBuildSnapshot,assertSameSnapshotPaths} from '../scripts/native-build-snapshot.mjs'
import {verifyComponentManifest} from '../scripts/component-integrity.mjs'
test('captured build stays verifiable after live source changes and rejects snapshot damage',()=>{
  const root=mkdtempSync(join(tmpdir(),'Nori captured build '))
  const target=join(root,'apps/desktop/release/snapshot/source')
  try{
    mkdirSync(join(root,'src'));writeFileSync(join(root,'src/input.txt'),'captured bytes')
    const receipt=captureBuildSnapshot(root,target,['src/input.txt'])
    writeFileSync(join(root,'src/input.txt'),'new live source bytes')
    assert.equal(readFileSync(join(target,'src/input.txt'),'utf8'),'captured bytes')
    verifyComponentManifest(target,receipt.manifest,['src/input.txt'])
    assert.equal(receipt.atomicRevision,false);assert.equal(receipt.releaseVerified,false)
    assert.throws(()=>captureBuildSnapshot(root,target,['src/input.txt']),/fresh/)
    assert.throws(()=>captureBuildSnapshot(root,join(root,'source-overwrite'),['src/input.txt']),/release output/)
    writeFileSync(join(target,'src/input.txt'),'damaged copy')
    assert.throws(()=>verifyComponentManifest(target,receipt.manifest,['src/input.txt']))
  }finally{assert.equal(resolve(dirname(root)),resolve(tmpdir()));rmSync(root,{recursive:true,force:true})}
})
test('closure comparison refuses stale initial inventories',()=>{
  assert.equal(assertSameSnapshotPaths(['a','b'],['b','a']),true)
  assert.throws(()=>assertSameSnapshotPaths(['a'],['a','new-required']),/missing new-required/)
  assert.throws(()=>assertSameSnapshotPaths(['a','stale'],['a']),/extra stale/)
})
