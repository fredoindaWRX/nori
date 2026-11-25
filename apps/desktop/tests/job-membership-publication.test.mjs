import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,readFileSync,writeFileSync,readdirSync,existsSync} from 'node:fs'
import {join} from 'node:path'
import {fileURLToPath} from 'node:url'
import {publishJobMembership} from '../scripts/job-membership-publication.mjs'
const verification=fileURLToPath(new URL('../../../verification/',import.meta.url))
const record={kind:'owned-job-members',nonce:'a'.repeat(64),rootPid:100,processIds:[100,200],syntheticOnly:true}
test('fully written exact membership is exclusively published without a leftover staging name',()=>{
  const fixture=mkdtempSync(join(verification,'.native-job-guardian-publication-'))
  publishJobMembership(fixture,record)
  assert.deepEqual(JSON.parse(readFileSync(join(fixture,'owned-job-membership.json'),'utf8')),record)
  assert.deepEqual(readdirSync(fixture),['owned-job-membership.json'])
})
test('foreign membership is never overwritten and the complete attempted publication is retained',()=>{
  const fixture=mkdtempSync(join(verification,'.native-job-guardian-publication-'))
  const target=join(fixture,'owned-job-membership.json'),foreign='foreign original bytes'
  writeFileSync(target,foreign,{flag:'wx'})
  assert.throws(()=>publishJobMembership(fixture,record),/EEXIST/)
  assert.equal(readFileSync(target,'utf8'),foreign)
  const staged=readdirSync(fixture).filter(name=>name.endsWith('.tmp'))
  assert.equal(staged.length,1)
  assert.deepEqual(JSON.parse(readFileSync(join(fixture,staged[0]),'utf8')),record)
})
test('oversized membership refuses before creating any publication file',()=>{
  const fixture=mkdtempSync(join(verification,'.native-job-guardian-publication-'))
  assert.throws(()=>publishJobMembership(fixture,{data:'x'.repeat(65536)}),/bound/)
  assert.equal(existsSync(join(fixture,'owned-job-membership.json')),false)
  assert.deepEqual(readdirSync(fixture),[])
})
