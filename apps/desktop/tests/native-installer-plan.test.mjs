import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,mkdirSync,existsSync,rmSync,symlinkSync,writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {nativeInstallerPlan} from '../scripts/native-installer-plan.mjs'

test('installer refuses a compiler redirected through a linked parent',()=>{
  const root=mkdtempSync(join(tmpdir(),'nori-installer-compiler-'))
  try {
    mkdirSync(join(root,'actual'))
    writeFileSync(join(root,'actual/ISCC.exe'),'not executed')
    symlinkSync(join(root,'actual'),join(root,'alias'),'junction')
    assert.throws(()=>nativeInstallerPlan(root,{candidate:'test',compiler:join(root,'alias/ISCC.exe')}),/Compiler must be an unlinked file/)
    assert.equal(existsSync(join(root,'apps')),false)
  } finally {rmSync(root,{recursive:true,force:true})}
})

test('installer output cannot redirect through a junction, even inside Nori',()=>{
  const root=mkdtempSync(join(tmpdir(),'nori-installer-linked-'))
  mkdirSync(join(root,'apps/desktop'),{recursive:true})
  mkdirSync(join(root,'protected-data'))
  try {
    symlinkSync(join(root,'protected-data'),join(root,'apps/desktop/release'),'junction')
    assert.throws(()=>nativeInstallerPlan(root,{candidate:'test'}),/Unsafe installer output ancestor/)
    assert.equal(existsSync(join(root,'protected-data/native-installer-test')),false)
  }finally {rmSync(root,{recursive:true,force:true})}
})

test('installer planning refuses absent compiler without creating output',()=>{
  const root=mkdtempSync(join(tmpdir(),'nori-installer-plan-'))
  try {
    assert.throws(()=>nativeInstallerPlan(root,{candidate:'test',compiler:join(root,'missing.exe')}),/compiler is required/)
    assert.equal(existsSync(join(root,'apps')),false)
    assert.throws(()=>nativeInstallerPlan(root,{candidate:'../escape'}),/Unsafe installer candidate/)
  } finally {rmSync(root,{recursive:true,force:true})}
})

test('installer planning preserves existing outputs before any build action',()=>{
  const root=mkdtempSync(join(tmpdir(),'nori-installer-existing-'))
  const output=join(root,'apps/desktop/release/native-installer-test')
  mkdirSync(output,{recursive:true})
  try {
    assert.throws(()=>nativeInstallerPlan(root,{candidate:'test'}),/previous files preserved/)
    assert.equal(existsSync(output),true)
  } finally {rmSync(root,{recursive:true,force:true})}
})
