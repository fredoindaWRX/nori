import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,mkdirSync,rmSync,writeFileSync,copyFileSync,constants} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {privateStatePlan} from '../scripts/private-state-plan.mjs'
import {privateStateSnapshot,verifyPrivateStateMigration} from '../scripts/private-state-integrity.mjs'

for(const component of ['desktop','core']) for(const folder of ['nested-old-state','..saved-state']) test(`migration refuses source ${folder} inside ${component} destination even for read-only inspection`,()=>{
  const root=mkdtempSync(join(tmpdir(),'nori-overlap-regression-'))
  try{
    const source=join(root,'state/private',component,folder)
    mkdirSync(source,{recursive:true})
    assert.throws(()=>privateStatePlan(root,source,{component,inspectExistingDestination:true}),/overlaps legacy state/)
  }finally{rmSync(root,{recursive:true,force:true})}
})

test('ordinary dot-prefixed durable names are preserved rather than treated as parent traversal',()=>{
  const root=mkdtempSync(join(tmpdir(),'nori-dot-name-regression-'))
  try{
    const source=join(root,'old-state')
    mkdirSync(join(source,'..saved-state'),{recursive:true})
    writeFileSync(join(source,'..saved-state','settings.json'),'synthetic fixture')
    const plan=privateStatePlan(root,source,{component:'core'})
    assert.deepEqual(plan.files.map(f=>f.path),['..saved-state/settings.json'])
    const snapshot=privateStateSnapshot(root,plan)
    mkdirSync(join(plan.destination,'..saved-state'),{recursive:true})
    copyFileSync(join(source,'..saved-state/settings.json'),join(plan.destination,'..saved-state/settings.json'),constants.COPYFILE_EXCL)
    const verified=verifyPrivateStateMigration(root,plan,snapshot)
    assert.equal(verified.copyContentMatches,true)
    assert.equal(verified.activationAuthorized,false)
  }finally{rmSync(root,{recursive:true,force:true})}
})
