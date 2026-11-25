import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {nativePythonInventory} from '../scripts/native-python-inventory.mjs'

function fixture() {
  const root=mkdtempSync(join(tmpdir(),'nori metadata '))
  for(const location of ['stt','voice']) mkdirSync(join(root,'runtime',location,'packages'),{recursive:true})
  const directory=join(root,'runtime/stt/packages/fixture-1.dist-info')
  mkdirSync(directory)
  return {root,path:join(directory,'METADATA')}
}
test('speech dependency metadata inventory is bounded and never implies license clearance',()=>{
  const {root,path}=fixture()
  try {
    writeFileSync(path,'Name: fixture\nVersion: 1\nLicense-Expression: MIT\nLicense-File: LICENSE\n\nDescription')
    const result=nativePythonInventory(root)
    assert.equal(result.packages.length,1)
    assert.equal(result.packages[0].name,'fixture')
    assert.deepEqual(result.packages[0].licenseExpressions,['MIT'])
    assert.match(result.packages[0].metadataSha256,/^[a-f0-9]{64}$/)
    assert.equal(result.packages[0].licenseEvidence[0].status,'missing')
    assert.equal(result.redistributionApproved,false)
    assert.equal(result.completeDependencyInventory,false)
    assert.equal(result.importsExecuted,false)
  } finally {rmSync(root,{recursive:true,force:true})}
})
test('license references are measured locally and traversal is not followed',()=>{
  const {root,path}=fixture()
  try {
    writeFileSync(path,'Name: fixture\nVersion: 1\nLicense-File: LICENSE\nLicense-File: ../../outside\n')
    writeFileSync(join(root,'runtime/stt/packages/fixture-1.dist-info/LICENSE'),'Fixture license')
    const evidence=nativePythonInventory(root).packages[0].licenseEvidence
    assert.equal(evidence[0].status,'present')
    assert.equal(evidence[0].bytes,15)
    assert.match(evidence[0].sha256,/^[a-f0-9]{64}$/)
    assert.equal(evidence[1].status,'unsafe-reference')
  } finally {rmSync(root,{recursive:true,force:true})}
})
test('ambiguous and oversized metadata are refused rather than guessed',()=>{
  const {root,path}=fixture()
  try {
    writeFileSync(path,'Name: fixture\nName: other\nVersion: 1\n')
    assert.throws(()=>nativePythonInventory(root),/Ambiguous/)
    writeFileSync(path,'x'.repeat(1024*1024+1))
    assert.throws(()=>nativePythonInventory(root),/bounds/)
  } finally {rmSync(root,{recursive:true,force:true})}
})
test('metadata 2.4 uses the installed licenses subdirectory',()=>{
  const {root,path}=fixture()
  try {
    const folder=join(root,'runtime/stt/packages/fixture-1.dist-info')
    mkdirSync(join(folder,'licenses'))
    writeFileSync(join(folder,'licenses/LICENSE'),'Actual license')
    writeFileSync(path,'Metadata-Version: 2.4\nName: fixture\nVersion: 1\nLicense-File: LICENSE\n')
    assert.equal(nativePythonInventory(root).packages[0].licenseEvidence[0].status,'present')
    writeFileSync(path,'Metadata-Version: 3.0\nName: fixture\nVersion: 1\n')
    assert.throws(()=>nativePythonInventory(root),/Unsupported/)
  } finally {rmSync(root,{recursive:true,force:true})}
})
test('legacy metadata notice relocation is recorded without false absence',()=>{
  const {root,path}=fixture()
  try {
    const folder=join(root,'runtime/stt/packages/fixture-1.dist-info')
    mkdirSync(join(folder,'licenses'))
    writeFileSync(join(folder,'licenses/LICENSE'),'Actual license')
    writeFileSync(path,'Metadata-Version: 2.1\nName: fixture\nVersion: 1\nLicense-File: LICENSE\n')
    const evidence=nativePythonInventory(root).packages[0].licenseEvidence[0]
    assert.equal(evidence.status,'present')
    assert.equal(evidence.layout,'legacy-relocated')
    assert.match(evidence.resolvedPath,/dist-info\/licenses\/LICENSE$/)
  } finally {rmSync(root,{recursive:true,force:true})}
})
