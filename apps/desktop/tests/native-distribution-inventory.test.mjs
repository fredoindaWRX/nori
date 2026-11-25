import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,mkdirSync,writeFileSync,rmSync,symlinkSync} from 'node:fs'
import {join,dirname} from 'node:path'
import {tmpdir} from 'node:os'
import {nativeDistributionPaths} from '../scripts/native-distribution-inventory.mjs'

test('native distribution excludes exact generated roots but retains state-named program helpers',()=>{
  const root=mkdtempSync(join(tmpdir(),'nori-distribution-inventory-'))
  const put=name=>{const path=join(root,name);mkdirSync(dirname(path),{recursive:true});writeFileSync(path,'fixture')}
  try{
    for(const name of ['state/private/test','verification/probe.json','native-payload-receipt.json',
      'integrations/location/private-state-path.ps1','program/verification-helper.py','nori/main.py'])put(name)
    assert.deepEqual(nativeDistributionPaths(root),['integrations/location/private-state-path.ps1',
      'nori/main.py','program/verification-helper.py'])
  }finally{rmSync(root,{recursive:true,force:true})}
})

test('excluded generated roots cannot conceal a linked distribution directory',()=>{
  const root=mkdtempSync(join(tmpdir(),'nori-distribution-link-'))
  const outside=mkdtempSync(join(tmpdir(),'nori-distribution-outside-'))
  try{
    symlinkSync(outside,join(root,'state'),'junction')
    assert.throws(()=>nativeDistributionPaths(root),/link or escape/)
  }finally{rmSync(root,{recursive:true,force:true});rmSync(outside,{recursive:true,force:true})}
})
