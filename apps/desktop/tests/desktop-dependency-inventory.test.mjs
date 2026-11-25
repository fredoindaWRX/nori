import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,writeFileSync,rmSync,mkdirSync} from 'node:fs'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {desktopDependencyInventory} from '../scripts/desktop-dependency-inventory.mjs'
function fixture(callback) {
  const root=mkdtempSync(join(tmpdir(),'nori archive metadata ')),path=join(root,'app.asar')
  writeFileSync(path,'fixture')
  try {callback(path)} finally {rmSync(root,{recursive:true,force:true})}
}
test('archive inventory reads package roots only and makes no release claim',()=>fixture(path=>{
  const bytes=Buffer.from(JSON.stringify({name:'fixture',version:'1',license:'MIT'}))
  const result=desktopDependencyInventory(path,{reader:{
    listPackage:()=>['\\node_modules\\fixture\\package.json','\\node_modules\\fixture\\internal\\package.json'],
    statFile:()=>({size:bytes.length}),extractFile:()=>bytes}})
  assert.equal(result.packages.length,1)
  assert.equal(result.packages[0].license,'MIT')
  assert.equal(result.completeDependencyInventory,false)
  assert.equal(result.dependencyCodeExecuted,false)
}))
test('archive links and oversized metadata never get extracted',()=>fixture(path=>{
  let extracted=false
  const result=desktopDependencyInventory(path,{reader:{
    listPackage:()=>['/node_modules/a/package.json','/node_modules/b/package.json'],
    statFile:(_archive,name)=>name.replaceAll('\\','/').includes('/a/')?{link:'elsewhere'}:{size:1024*1024+1},
    extractFile:()=>{extracted=true;throw Error('must not read')}}})
  assert.equal(extracted,false)
  assert.equal(result.refused.length,2)
}))
test('unpacked metadata is bounded and read directly without archive extraction',()=>fixture(path=>{
  const folder=join(path+'.unpacked','node_modules','fixture')
  mkdirSync(folder,{recursive:true})
  const bytes=Buffer.from(JSON.stringify({name:'fixture',version:'1'}))
  writeFileSync(join(folder,'package.json'),bytes)
  const result=desktopDependencyInventory(path,{reader:{
    listPackage:()=>['/node_modules/fixture/package.json'],
    statFile:()=>({unpacked:true,size:bytes.length}),
    extractFile:()=>{throw Error('Must not extract unpacked metadata')}}})
  assert.equal(result.packages[0].storage,'unpacked')
  assert.equal(result.packages[0].name,'fixture')
}))
