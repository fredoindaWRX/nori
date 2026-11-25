const test=require('node:test')
const assert=require('node:assert/strict')
const {mkdtempSync,rmSync,writeFileSync,readFileSync,existsSync,mkdirSync,symlinkSync}=require('node:fs')
const {join}=require('node:path')
const {tmpdir}=require('node:os')
const {acquireStateOwner}=require('../desktop/state-owner.cjs')

test('Core and migration ownership are mutually exclusive until exact owner release',()=>{
  const root=mkdtempSync(join(tmpdir(),'nori-state-owner-'))
  try{
    const owner=acquireStateOwner(root)
    assert.equal(owner.assertHeld().purpose,'core')
    assert.throws(()=>acquireStateOwner(root,{purpose:'migration'}),/EEXIST/)
    owner.release();owner.release()
    assert.throws(()=>owner.assertHeld(),/already released/)
    const migration=acquireStateOwner(root,{purpose:'migration'})
    assert.throws(()=>acquireStateOwner(root),/EEXIST/)
    migration.release()
    assert.equal(existsSync(join(root,'.nori-state-owner.json')),false)
  }finally{rmSync(root,{recursive:true,force:true})}
})
test('foreign or stale records are preserved rather than stolen or deleted',()=>{
  const root=mkdtempSync(join(tmpdir(),'nori-state-owner-'))
  try{
    const owner=acquireStateOwner(root),path=join(root,'.nori-state-owner.json')
    writeFileSync(path,'foreign fixture')
    assert.throws(()=>owner.release(),/foreign record preserved/)
    assert.throws(()=>acquireStateOwner(root),/EEXIST/)
    assert.equal(readFileSync(path,'utf8'),'foreign fixture')
  }finally{rmSync(root,{recursive:true,force:true})}
})
test('state ownership refuses junction directories and unknown purposes',()=>{
  const root=mkdtempSync(join(tmpdir(),'nori-state-owner-'))
  try{
    mkdirSync(join(root,'actual'));symlinkSync(join(root,'actual'),join(root,'linked'),'junction')
    assert.throws(()=>acquireStateOwner(join(root,'linked')),/Linked state ownership/)
    assert.throws(()=>acquireStateOwner(root,{purpose:'anything'}),/Unknown state ownership/)
  }finally{rmSync(root,{recursive:true,force:true})}
})

test('oversized foreign ownership record is refused and preserved',()=>{
  const root=mkdtempSync(join(tmpdir(),'nori-state-owner-'))
  try{
    const owner=acquireStateOwner(root),path=join(root,'.nori-state-owner.json')
    writeFileSync(path,Buffer.alloc(1024*1024,65))
    assert.throws(()=>owner.assertHeld(),/foreign record preserved/)
    assert.throws(()=>owner.release(),/foreign record preserved/)
    assert.equal(readFileSync(path).length,1024*1024)
    assert.throws(()=>acquireStateOwner(root),/EEXIST/)
  }finally{rmSync(root,{recursive:true,force:true})}
})
test('desktop profile ownership excludes migration until release',()=>{
  const root=mkdtempSync(join(tmpdir(),'nori-desktop-owner-'))
  try{
    const owner=acquireStateOwner(root,{purpose:'desktop'})
    assert.equal(owner.assertHeld().purpose,'desktop')
    assert.throws(()=>acquireStateOwner(root,{purpose:'migration'}),/EEXIST/)
    owner.release()
    const migration=acquireStateOwner(root,{purpose:'migration'})
    migration.release()
  }finally{rmSync(root,{recursive:true,force:true})}
})
