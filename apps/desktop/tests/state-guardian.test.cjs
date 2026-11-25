const test=require('node:test')
const assert=require('node:assert/strict')
const {mkdtempSync,writeFileSync,readFileSync,existsSync,mkdirSync,symlinkSync,rmSync}=require('node:fs')
const {join}=require('node:path')
const {spawnSync}=require('node:child_process')
const {acquireStateOwner,acquireStateGuardian}=require('../desktop/state-owner.cjs')
const verification=join(__dirname,'../../../verification')
const fixtures=new Set()
const fresh=()=>{const root=mkdtempSync(join(verification,'.native-state-guardian-'));fixtures.add(root);return root}
test.afterEach(()=>{for(const root of fixtures)rmSync(root,{recursive:true,force:true});fixtures.clear()})

test('external guard permits the application owner but blocks migration beyond ordinary owner release',()=>{
  const root=fresh(),guard=acquireStateGuardian(root)
  assert.equal(guard.assertHeld().purpose,'guardian')
  const owner=acquireStateOwner(root,{purpose:'desktop'})
  assert.throws(()=>acquireStateOwner(root,{purpose:'migration'}),/EEXIST/)
  owner.release()
  assert.equal(existsSync(join(root,'.nori-state-owner.json')),false)
  assert.throws(()=>acquireStateOwner(root,{purpose:'migration'}),/EEXIST/)
  guard.release()
  const migration=acquireStateOwner(root,{purpose:'migration'});migration.release()
})

test('guard cannot arm while any ordinary writer or migration owns the directory',()=>{
  for(const purpose of ['desktop','core','migration']){
    const root=fresh(),owner=acquireStateOwner(root,{purpose})
    assert.throws(()=>acquireStateGuardian(root),/EEXIST/)
    assert.equal(existsSync(join(root,'.nori-state-guardian.json')),false)
    owner.assertHeld();owner.release()
  }
})

test('stale, oversized and foreign guardian records block migration without being read or stolen',()=>{
  const root=fresh(),path=join(root,'.nori-state-guardian.json')
  for(const value of ['foreign dead owner',Buffer.alloc(1024*1024,65)]){
    writeFileSync(path,value)
    assert.throws(()=>acquireStateOwner(root,{purpose:'migration'}),/EEXIST/)
    assert.throws(()=>acquireStateGuardian(root),/EEXIST/)
    assert.equal(readFileSync(path).length,Buffer.byteLength(value))
    assert.equal(existsSync(join(root,'.nori-state-owner.json')),false)
  }
})

test('guardian exact-release refuses a foreign replacement and linked roots',()=>{
  const root=fresh(),path=join(root,'.nori-state-guardian.json'),guard=acquireStateGuardian(root)
  writeFileSync(path,'foreign replacement')
  assert.throws(()=>guard.release(),/foreign record preserved/)
  assert.equal(readFileSync(path,'utf8'),'foreign replacement')
  mkdirSync(join(root,'real'));symlinkSync(join(root,'real'),join(root,'alias'),'junction')
  assert.throws(()=>acquireStateGuardian(join(root,'alias')),/Linked/)
})

test('migration rechecks a guardian installed between initial check and ordinary record creation',()=>{
  const root=fresh()
  const result=spawnSync(process.execPath,['-e',`
    const fs=require('node:fs'),path=require('node:path');
    const directory=process.argv[1],original=fs.openSync;
    fs.openSync=function(file,flags,...rest){
      if(flags==='wx'&&path.basename(file)==='.nori-state-owner.json')
        fs.writeFileSync(path.join(directory,'.nori-state-guardian.json'),'synthetic raced guard');
      return original.call(fs,file,flags,...rest);
    };
    const {acquireStateOwner}=require(process.argv[2]);
    try{acquireStateOwner(directory,{purpose:'migration'});process.exitCode=2}
    catch(error){if(error.code!=='EEXIST')throw error}
  `,root,require.resolve('../desktop/state-owner.cjs')],{encoding:'utf8',windowsHide:true,shell:false,timeout:5000})
  assert.equal(result.status,0,result.stderr)
  assert.equal(existsSync(join(root,'.nori-state-owner.json')),false)
  assert.equal(readFileSync(join(root,'.nori-state-guardian.json'),'utf8'),'synthetic raced guard')
})
