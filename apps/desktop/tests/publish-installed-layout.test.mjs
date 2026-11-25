import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,mkdirSync,copyFileSync,writeFileSync,readFileSync,existsSync,readdirSync,rmSync} from 'node:fs'
import {join,resolve} from 'node:path'
import {spawnSync} from 'node:child_process'
import {createRequire} from 'node:module'
import {publishFreshInstalledLayout} from '../scripts/publish-installed-layout.mjs'
const require=createRequire(import.meta.url)
const {desktopStateSelection}=require('../desktop/desktop-state-selection.cjs')
const {acquireStateOwner}=require('../desktop/state-owner.cjs')
function fixture(run){
  const root=mkdtempSync(join(resolve(import.meta.dirname,'../../../verification'),'.installed-publication-'))
  const suite=join(root,'resources/NoriSuite'),scripts=join(root,'maintenance/scripts')
  const legacy=[join(root,'old-Nori'),join(root,'old-Cortana'),join(root,'old-NoriV2')]
  const powershell=join(process.env.SystemRoot,'System32/WindowsPowerShell/v1.0/powershell.exe')
  try{
    mkdirSync(suite,{recursive:true});mkdirSync(scripts,{recursive:true})
    writeFileSync(join(root,'Nori.exe'),'synthetic entry; never execute')
    for(const name of ['verify-private-state-acl.ps1','verify-browser-state-acl.ps1','browser-capability-sid.ps1'])
      copyFileSync(join(import.meta.dirname,'../scripts',name),join(scripts,name))
    for(const storageClass of ['private','browser']){
      const result=spawnSync(powershell,['-NoProfile','-File',join(import.meta.dirname,'../scripts/provision-private-state.ps1'),
        '-Root',suite,'-StorageClass',storageClass,'-Apply'],{shell:false,windowsHide:true,encoding:'utf8',timeout:10000})
      assert.equal(result.status,0,result.stderr)
    }
    mkdirSync(join(suite,'state/private/core'));mkdirSync(join(suite,'state/private/desktop'))
    run({root,suite,legacy,marker:join(root,'nori-install-layout.json'),deps:{legacyProfiles:()=>legacy}})
  }finally{rmSync(root,{recursive:true,force:true})}
}
const windows={skip:process.platform!=='win32',timeout:30000}
test('publication requires literal fresh-install authorization before inspecting paths',()=>{
  for(const value of [undefined,false,'true',1])assert.throws(()=>publishFreshInstalledLayout('unused',{freshInstall:value}),/Explicit fresh/)
})
test('actual prepared fresh fixture publishes policy accepted by ordinary selection',windows,()=>fixture(({root,suite,deps,marker})=>{
  const result=publishFreshInstalledLayout(root,{freshInstall:true},deps)
  assert.equal(result.policyPublished,true);assert.equal(result.migrationPerformed,false)
  assert.equal(result.originalInstallerOwnerVerified,false)
  const selected=desktopStateSelection({packaged:true,executable:join(root,'Nori.exe'),suiteRoot:suite,appRoot:join(root,'resources/app.asar')})
  assert.equal(selected.permissionsVerified,true)
  assert.ok(existsSync(marker));assert.equal(readdirSync(root).some(name=>name.endsWith('.tmp')),false)
  for(const path of [selected.core,selected.desktop,selected.browser])assert.deepEqual(readdirSync(path),[])
  assert.throws(()=>publishFreshInstalledLayout(root,{freshInstall:true},deps),/Existing install policy preserved/)
}))
test('known existing legacy profile blocks fresh activation and remains unchanged',windows,()=>fixture(({root,legacy,deps,marker})=>{
  mkdirSync(legacy[0]);writeFileSync(join(legacy[0],'memory.txt'),'keep owner memory')
  assert.throws(()=>publishFreshInstalledLayout(root,{freshInstall:true},deps),/requires verified migration/)
  assert.equal(existsSync(marker),false);assert.equal(readFileSync(join(legacy[0],'memory.txt'),'utf8'),'keep owner memory')
}))
test('nonempty prepared component is not silently relabeled as fresh',windows,()=>fixture(({root,suite,deps,marker})=>{
  const existing=join(suite,'state/private/core/memory.json');writeFileSync(existing,'{"keep":true}')
  assert.throws(()=>publishFreshInstalledLayout(root,{freshInstall:true},deps),/Nonempty prepared state/)
  assert.equal(existsSync(marker),false);assert.equal(readFileSync(existing,'utf8'),'{"keep":true}')
  assert.equal(existsSync(join(suite,'state/private/core/.nori-state-owner.json')),false)
}))
test('competing owner blocks publication without stealing its record',windows,()=>fixture(({root,suite,deps,marker})=>{
  const owner=acquireStateOwner(join(suite,'state/private/desktop'),{purpose:'desktop'})
  try{
    assert.throws(()=>publishFreshInstalledLayout(root,{freshInstall:true},deps),/EEXIST/)
    owner.assertHeld();assert.equal(existsSync(marker),false)
    assert.equal(existsSync(join(suite,'state/private/core/.nori-state-owner.json')),false)
  }finally{owner.release()}
}))
