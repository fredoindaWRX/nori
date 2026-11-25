import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,writeFileSync,readFileSync,rmSync,mkdirSync,existsSync,statSync,symlinkSync} from 'node:fs'
import {createHash} from 'node:crypto'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {verifiedCopy,verifiedHardlink} from '../scripts/verified-copy.mjs'

test('reused hashing buffer handles multi-block tails and empty subsequent files',()=>{
  const root=mkdtempSync(join(tmpdir(),'nori-copy-buffer-'))
  try{
    for(const [index,bytes] of [Buffer.alloc(2*1024*1024+17,91),Buffer.from('short'),Buffer.alloc(0)].entries()){
      const source=join(root,'source'+index),target=join(root,'target'+index)
      writeFileSync(source,bytes)
      const expected=createHash('sha256').update(bytes).digest('hex')
      assert.equal(verifiedCopy(source,target,expected),'copied')
      assert.deepEqual(readFileSync(target),bytes)
      assert.equal(verifiedCopy(source,target,expected),'reused')
    }
  }finally{rmSync(root,{recursive:true,force:true})}
})

test('verified model hardlink preserves bytes and refuses mismatched source or occupied target',()=>{
  const root=mkdtempSync(join(tmpdir(),'nori-model-hardlink-'))
  try{
    const source=join(root,'stage','model.gguf'),target=join(root,'package','model.gguf')
    const payload=Buffer.alloc(128*1024+9,17)
    mkdirSync(join(root,'stage'));mkdirSync(join(root,'package'));writeFileSync(source,payload)
    const expected=createHash('sha256').update(payload).digest('hex')
    assert.deepEqual(verifiedHardlink(source,target,expected,join(root,'package')),{status:'linked',sha256:expected})
    assert.equal(statSync(source).ino,statSync(target).ino)
    assert.deepEqual(readFileSync(target),payload)
    assert.throws(()=>verifiedHardlink(source,target,expected,join(root,'package')),/destination already exists/)
    assert.throws(()=>verifiedHardlink(source,join(root,'package','bad.gguf'),'0'.repeat(64),join(root,'package')),/Source file failed SHA-256/)
    assert.equal(existsSync(join(root,'package','bad.gguf')),false)
  }finally{rmSync(root,{recursive:true,force:true})}
})

test('model source digest mismatch fails before writing destination',()=>{
  const root=mkdtempSync(join(tmpdir(),'nori-source-hash-test-'))
  try{
    const source=join(root,'source'),target=join(root,'target')
    writeFileSync(source,'damaged model')
    const expected=createHash('sha256').update('valid model').digest('hex')
    assert.throws(()=>verifiedCopy(source,target,expected),/Source file failed SHA-256/)
    assert.equal(existsSync(target),false)
    const actual=createHash('sha256').update('damaged model').digest('hex')
    assert.equal(verifiedCopy(source,target,actual),'copied')
    assert.throws(()=>verifiedCopy(source,target,'bad-digest'),/Invalid expected/)
  }finally{rmSync(root,{recursive:true,force:true})}
})

test('model hardlink refuses a junctioned destination parent outside the package root',()=>{
  const root=mkdtempSync(join(tmpdir(),'nori-model-junction-'))
  try{
    const source=join(root,'source.gguf'),allowed=join(root,'package'),outside=join(root,'outside')
    mkdirSync(allowed);mkdirSync(outside);writeFileSync(source,'model bytes')
    symlinkSync(outside,join(allowed,'linked'),'junction')
    const expected=createHash('sha256').update('model bytes').digest('hex')
    assert.throws(()=>verifiedHardlink(source,join(allowed,'linked','model.gguf'),expected,allowed),/parent is linked/)
    assert.equal(existsSync(join(outside,'model.gguf')),false)
  }finally{rmSync(root,{recursive:true,force:true})}
})

test('staging reuses matching bytes and repairs same-size corrupt bytes',()=>{
  const root=mkdtempSync(join(tmpdir(),'nori-copy-test-'))
  try{
    const source=join(root,'source'),target=join(root,'target')
    writeFileSync(source,'good');writeFileSync(target,'evil')
    assert.equal(verifiedCopy(source,target),'copied')
    assert.equal(readFileSync(target,'utf8'),'good')
    assert.equal(verifiedCopy(source,target),'reused')
    writeFileSync(source,'newer source')
    assert.equal(verifiedCopy(source,target),'copied')
    assert.equal(readFileSync(target,'utf8'),'newer source')
    mkdirSync(join(root,'directory'))
    assert.throws(()=>verifiedCopy(source,join(root,'directory')),/regular destination/)
  }finally{rmSync(root,{recursive:true,force:true})}
})
