import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,writeFileSync,mkdirSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createHash} from 'node:crypto'
import {buildComponentManifest,verifyComponentManifest} from '../scripts/component-integrity.mjs'

test('shared hashing buffer preserves multi-block, short-tail and empty-file digests',()=>{
  const root=mkdtempSync(join(tmpdir(),'nori-component-buffer-'))
  try {
    const content=Buffer.alloc(2*1024*1024+17)
    for(let index=0;index<content.length;index++)content[index]=index%251
    const data={'a-large':content,'b-short':Buffer.from('short tail'),'c-empty':Buffer.alloc(0)}
    for(const [name,bytes] of Object.entries(data))writeFileSync(join(root,name),bytes)
    const manifest=buildComponentManifest(root,Object.keys(data))
    for(const file of manifest.files){
      assert.equal(file.bytes,data[file.path].length)
      assert.equal(file.sha256,createHash('sha256').update(data[file.path]).digest('hex'))
    }
    assert.equal(verifyComponentManifest(root,manifest,Object.keys(data)).verified_files,3)
    const progress=[]
    verifyComponentManifest(root,manifest,Object.keys(data),{onFile:record=>progress.push(record)})
    assert.deepEqual(progress.map(record=>record.path),manifest.files.map(file=>file.path))
    assert.deepEqual(progress.map(record=>record.verifiedFiles),[1,2,3])
    assert.ok(progress.every(record=>Number.isFinite(record.elapsedMs)&&record.elapsedMs>=0))
    assert.throws(()=>verifyComponentManifest(root,manifest,undefined,{onFile:true}),/progress callback/)
    content[content.length-1]^=1;writeFileSync(join(root,'a-large'),content)
    const rejected=[]
    assert.throws(()=>verifyComponentManifest(root,manifest,undefined,{onFile:record=>rejected.push(record)}),/integrity mismatch/)
    assert.deepEqual(rejected,[],'Corrupt bytes must never receive a verified progress event')
  }finally{rmSync(root,{recursive:true,force:true})}
})

test('component bytes verify; same-size corruption and missing files fail',()=>{
  const root=mkdtempSync(join(tmpdir(),'nori-component-'))
  try{
    writeFileSync(join(root,'module.bin'),'abc')
    const manifest=buildComponentManifest(root,['module.bin'])
    assert.equal(verifyComponentManifest(root,manifest).verified_files,1)
    assert.equal(verifyComponentManifest(root,manifest).publisher_authenticated,false)
    writeFileSync(join(root,'module.bin'),'abd')
    assert.throws(()=>verifyComponentManifest(root,manifest),/mismatch/)
    rmSync(join(root,'module.bin'))
    assert.throws(()=>verifyComponentManifest(root,manifest))
  }finally{rmSync(root,{recursive:true,force:true})}
})
test('component schema rejects traversal, duplicate entries and directories',()=>{
  const root=mkdtempSync(join(tmpdir(),'nori-component-'))
  try{
    writeFileSync(join(root,'a'),'a');mkdirSync(join(root,'directory'))
    for(const path of ['../a','a/../a','C:/a','/a','a\\b','directory','a:stream',
                       'a.','a ','CON','NUL.txt','COM1.exe','a?','a*','a\u0001'])
      assert.throws(()=>buildComponentManifest(root,[path]))
    assert.throws(()=>buildComponentManifest(root,['a','a']))
    assert.throws(()=>buildComponentManifest(root,['a','A']))
    const m=buildComponentManifest(root,['a'])
    assert.throws(()=>verifyComponentManifest(root,{...m,files:[...m.files,...m.files]}))
    assert.throws(()=>verifyComponentManifest(root,{...m,files:[{...m.files[0],bytes:-1}]}))
    assert.equal(verifyComponentManifest(root,m,['a']).required_set_checked,true)
    assert.throws(()=>verifyComponentManifest(root,m,['a','missing']),/required components/)
    assert.throws(()=>verifyComponentManifest(root,m,['different']),/required components/)
    assert.throws(()=>verifyComponentManifest(root,m,['a','A']),/required components/)
    assert.throws(()=>verifyComponentManifest(root,{...m,files:[...m.files,{...m.files[0],path:'A'}]}))
  }finally{rmSync(root,{recursive:true,force:true})}
})
test('component manifest ordering is deterministic without mutating caller list',()=>{
  const root=mkdtempSync(join(tmpdir(),'nori-component-'))
  try{
    writeFileSync(join(root,'a'),'a');writeFileSync(join(root,'b'),'b')
    const paths=['b','a']
    assert.deepEqual(buildComponentManifest(root,paths),buildComponentManifest(root,['a','b']))
    assert.deepEqual(paths,['b','a'])
  }finally{rmSync(root,{recursive:true,force:true})}
})
