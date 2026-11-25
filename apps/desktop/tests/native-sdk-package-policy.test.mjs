import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {verifyNativeSdkIsolation} from '../scripts/native-sdk-package-policy.mjs'
function fixture(callback) {
  const root=mkdtempSync(join(tmpdir(),'nori sdk policy '))
  mkdirSync(join(root,'resources'))
  writeFileSync(join(root,'resources/app.asar'),'fixture')
  try {callback(root)} finally {rmSync(root,{recursive:true,force:true})}
}
test('artifact gate refuses excluded SDK and adapters regardless of builder filters',()=>fixture(root=>{
  for(const path of ['/node_modules/@anthropic-ai/sdk/package.json','\\bridge\\chrome.mjs','/bridge/vision.mjs'])
    assert.throws(()=>verifyNativeSdkIsolation(root,{reader:{listPackage:()=>[path]}}),/reappeared/)
  const result=verifyNativeSdkIsolation(root,{reader:{listPackage:()=>['/bridge/server.mjs']}})
  assert.equal(result.nativeSdkIsolated,true)
  assert.equal(result.releaseVerified,false)
}))
test('unpacked vendor SDK presence blocks native artifact admission',()=>fixture(root=>{
  mkdirSync(join(root,'resources/app.asar.unpacked/node_modules/@anthropic-ai'),{recursive:true})
  assert.throws(()=>verifyNativeSdkIsolation(root,{reader:{listPackage:()=>[]}}),/unpacked/)
}))
