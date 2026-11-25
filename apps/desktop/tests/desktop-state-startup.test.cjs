const test=require('node:test')
const assert=require('node:assert/strict')
const {mkdtempSync,mkdirSync,existsSync,writeFileSync,rmSync}=require('node:fs')
const {join}=require('node:path')
const {tmpdir}=require('node:os')
const {acquireStateOwner}=require('../desktop/state-owner.cjs')
const {acquireDesktopStateOwners}=require('../desktop/desktop-state-startup.cjs')

test('state ownership conflicts are returned for clean startup handling and partial leases are released',()=>{
  const root=mkdtempSync(join(tmpdir(),'nori-desktop-startup-'))
  const desktop=join(root,'desktop'),browser=join(root,'browser')
  mkdirSync(desktop);mkdirSync(browser)
  const foreign=JSON.stringify({schema:1,pid:1,owner:'4fd96358-9adf-4eb7-8df8-267a78d26cc6',purpose:'desktop'})
  writeFileSync(join(browser,'.nori-state-owner.json'),foreign,{flag:'wx'})
  try {
    const result=acquireDesktopStateOwners({desktopDirectory:desktop,browserDirectory:browser,acquireStateOwner})
    assert.equal(result.desktopOwner,null)
    assert.equal(result.browserOwner,null)
    assert.equal(result.error.code,'EEXIST')
    assert.equal(existsSync(join(desktop,'.nori-state-owner.json')),false)
    assert.equal(require('node:fs').readFileSync(join(browser,'.nori-state-owner.json'),'utf8'),foreign)
  } finally {rmSync(root,{recursive:true,force:true})}
})
