import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,existsSync,rmSync} from 'node:fs'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {createRequire} from 'node:module'
import {stageCorePrivateState,stageDesktopPrivateState,stagePrivateState} from '../scripts/stage-core-private-state.mjs'
const {acquireStateOwner}=createRequire(import.meta.url)('../desktop/state-owner.cjs')
test('staging refuses an unspecified or unknown component before mutation',()=>{
  for(const component of [undefined,'other'])assert.throws(()=>stagePrivateState('missing','missing',{component}),/Unknown/)
})
test('protected desktop staging preserves durable and unknown data without activation',
  {skip:process.platform!=='win32',timeout:15000},()=>{
    const root=mkdtempSync(join(tmpdir(),'nori desktop staging ')),source=join(root,'old-desktop')
    mkdirSync(source)
    mkdirSync(join(source,'settings'))
    mkdirSync(join(source,'unknown-empty'))
    mkdirSync(join(source,'Cache'));mkdirSync(join(source,'models'))
    writeFileSync(join(source,'Preferences'),'synthetic preferences')
    writeFileSync(join(source,'settings','layout.json'),'synthetic layout')
    writeFileSync(join(source,'Cache','fixture'),'synthetic cache')
    writeFileSync(join(source,'models','fixture'),'synthetic model')
    try{
      const writer=acquireStateOwner(source,{purpose:'desktop'})
      assert.throws(()=>stageDesktopPrivateState(root,source),/EEXIST/)
      assert.equal(existsSync(join(root,'state')),false)
      writer.release()
      const result=stageDesktopPrivateState(root,source)
      assert.equal(result.component,'desktop')
      assert.equal(result.protectedAclVerified,true)
      assert.equal(result.destinationOwnershipHeldThroughoutCopy,true)
      assert.equal(result.activationAuthorized,false)
      assert.equal(result.quiescenceVerified,false)
      assert.equal(result.files,2)
      assert.deepEqual(result.excludedCaches,['Cache'])
      assert.deepEqual(result.separateComponents.map(item=>item.path),['.nori-state-owner.json','models'])
      const destination=join(root,'state/private/desktop')
      assert.equal(readFileSync(join(destination,'Preferences'),'utf8'),'synthetic preferences')
      assert.equal(readFileSync(join(destination,'settings/layout.json'),'utf8'),'synthetic layout')
      assert.equal(existsSync(join(destination,'unknown-empty')),true)
      for(const name of ['Cache','models','.nori-state-owner.json'])assert.equal(existsSync(join(destination,name)),false)
      assert.equal(readFileSync(join(source,'Cache/fixture'),'utf8'),'synthetic cache')
      assert.equal(readFileSync(join(source,'models/fixture'),'utf8'),'synthetic model')
      assert.equal(existsSync(join(source,'.nori-state-owner.json')),false)
      assert.throws(()=>stageDesktopPrivateState(root,source),/destination preserved/)
    }finally{rmSync(root,{recursive:true,force:true})}
  })

test('protected Core staging preserves source and refuses occupied state or competing writer',
  {skip:process.platform!=='win32',timeout:15000},()=>{
    const root=mkdtempSync(join(tmpdir(),'nori core staging ')),source=join(root,'old-core')
    mkdirSync(source);writeFileSync(join(source,'memory.json'),'synthetic memory')
    try{
      const writer=acquireStateOwner(source)
      assert.throws(()=>stageCorePrivateState(root,source),/EEXIST/)
      assert.equal(existsSync(join(root,'state')),false)
      writer.release()
      const evidence=stageCorePrivateState(root,source)
      assert.equal(evidence.protectedAclVerified,true)
      assert.equal(evidence.cooperativeOwnershipHeldThroughoutCopy,true)
      assert.equal(evidence.destinationOwnershipHeldThroughoutCopy,true)
      assert.equal(evidence.activationAuthorized,false)
      assert.equal(evidence.quiescenceVerified,false)
      assert.equal(readFileSync(join(root,'state/private/core/memory.json'),'utf8'),'synthetic memory')
      assert.equal(readFileSync(join(source,'memory.json'),'utf8'),'synthetic memory')
      assert.equal(existsSync(join(source,'.nori-state-owner.json')),false)
      assert.equal(existsSync(join(root,'state/private/core/.nori-state-owner.json')),false)
      assert.throws(()=>stageCorePrivateState(root,source),/destination preserved/)
      assert.equal(existsSync(join(source,'.nori-state-owner.json')),false)
    }finally{rmSync(root,{recursive:true,force:true})}
  })
