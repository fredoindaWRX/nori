import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,existsSync,rmSync,symlinkSync} from 'node:fs'
import {join,dirname} from 'node:path'
import {tmpdir} from 'node:os'
import {createRequire} from 'node:module'
import {desktopStateSplitPlan} from '../scripts/desktop-state-split-plan.mjs'
import {stageDesktopStateLayout,desktopStatePartSnapshot} from '../scripts/stage-desktop-state-layout.mjs'
import {privateStateSnapshot,verifyPrivateStateCopy} from '../scripts/private-state-integrity.mjs'
import {privateStatePlan} from '../scripts/private-state-plan.mjs'
import {stageDesktopPrivateState} from '../scripts/stage-core-private-state.mjs'
const {acquireStateOwner}=createRequire(import.meta.url)('../desktop/state-owner.cjs')
function fixture(){
  const root=mkdtempSync(join(tmpdir(),'nori-split-state-')),source=join(root,'old');mkdirSync(source)
  const put=name=>{mkdirSync(dirname(join(source,name)),{recursive:true});writeFileSync(join(source,name),'synthetic '+name)}
  for(const name of ['settings/theme.json','secrets/fixture','unknown/state','Network/Cookies',
    'Local Storage/fixture','Session Storage/fixture','Preferences','Cache/fixture','models/fixture'])put(name)
  return {root,source,cleanup:()=>rmSync(root,{recursive:true,force:true})}
}
test('split plan preserves durable browser state, native secrets and unknown data exactly once',()=>{
  const f=fixture()
  try{
    const plan=desktopStateSplitPlan(f.root,f.source)
    assert.deepEqual(plan.private.files.map(file=>file.path),['secrets/fixture','settings/theme.json','unknown/state'])
    assert.deepEqual(plan.browser.files.map(file=>file.path),['Local Storage/fixture','Network/Cookies','Preferences','Session Storage/fixture'])
    assert.deepEqual(plan.full.excludedCaches,['Cache'])
    assert.equal(plan.full.separateComponents[0].path,'models')
    assert.equal(plan.browserDataSensitive,true);assert.equal(plan.activationAuthorized,false)
    assert.equal(existsSync(join(f.root,'state')),false)
    symlinkSync(join(f.source,'settings'),join(f.source,'Local Storage','linked'),'junction')
    assert.throws(()=>desktopStateSplitPlan(f.root,f.source),/Linked/)
  }finally{f.cleanup()}
})
test('Windows split staging protects both copies, preserves original and refuses occupied or owned state',
  {skip:process.platform!=='win32',timeout:15000},()=>{
    const f=fixture()
    try{
      const writer=acquireStateOwner(f.source,{purpose:'desktop'})
      try{assert.throws(()=>stageDesktopStateLayout(f.root,f.source),/EEXIST/)}finally{writer.release()}
      assert.equal(existsSync(join(f.root,'state')),false)
      const evidence=stageDesktopStateLayout(f.root,f.source)
      assert.equal(evidence.privateFiles,3);assert.equal(evidence.browserFiles,4)
      assert.equal(evidence.privateAclVerified,true);assert.equal(evidence.browserInitialPrivateAclVerified,true)
      assert.equal(evidence.activationAuthorized,false);assert.equal(evidence.browserRuntimeAclPolicyVerified,false)
      assert.equal(readFileSync(join(f.root,'state/browser/Network/Cookies'),'utf8'),'synthetic Network/Cookies')
      assert.equal(readFileSync(join(f.root,'state/private/desktop/secrets/fixture'),'utf8'),'synthetic secrets/fixture')
      assert.equal(existsSync(join(f.root,'state/private/desktop/Network')),false)
      assert.equal(existsSync(join(f.root,'state/browser/secrets')),false)
      for(const name of ['settings/theme.json','Network/Cookies','Cache/fixture','models/fixture'])
        assert.equal(readFileSync(join(f.source,name),'utf8'),'synthetic '+name)
      assert.equal(existsSync(join(f.source,'.nori-state-owner.json')),false)
      assert.equal(existsSync(join(f.root,'state/browser/.nori-state-owner.json')),false)
      assert.throws(()=>stageDesktopStateLayout(f.root,f.source),/destination preserved/)
    }finally{f.cleanup()}
  })
test('actual planning and staging APIs reject a linked main-root spelling before state ownership',
  {skip:process.platform!=='win32'},()=>{
    const f=fixture(),alias=f.root+'-alias'
    try{
      symlinkSync(f.root,alias,'junction')
      for(const operation of [privateStatePlan,desktopStateSplitPlan,stageDesktopPrivateState,stageDesktopStateLayout])
        assert.throws(()=>operation(alias,f.source),/Linked/)
      assert.equal(existsSync(join(f.root,'state')),false)
      assert.equal(existsSync(join(f.source,'.nori-state-owner.json')),false)
    }finally{rmSync(alias,{force:true});f.cleanup()}
  })
test('split copies use original captured hashes even if source temporarily changes and reverts',()=>{
  const f=fixture()
  try{
    const plan=desktopStateSplitPlan(f.root,f.source),full=privateStateSnapshot(f.root,plan.full)
    const original=readFileSync(join(f.source,'Preferences'))
    writeFileSync(join(f.source,'Preferences'),Buffer.alloc(original.length,120))
    const browserSnapshot=desktopStatePartSnapshot(full,plan.browser)
    const corrupted=join(f.root,'corrupted-browser');mkdirSync(corrupted)
    for(const directory of plan.browser.directories)mkdirSync(join(corrupted,directory),{recursive:true})
    for(const file of plan.browser.files)writeFileSync(join(corrupted,file.path),readFileSync(join(f.source,file.path)))
    writeFileSync(join(f.source,'Preferences'),original)
    assert.throws(()=>verifyPrivateStateCopy(corrupted,browserSnapshot),/integrity mismatch/)
    assert.deepEqual(browserSnapshot.manifest.files,full.manifest.files.filter(file=>plan.browser.files.some(item=>item.path===file.path)))
    assert.throws(()=>desktopStatePartSnapshot(full,{files:[{path:'not-captured'}],directories:[]}),/differs/)
  }finally{f.cleanup()}
})
