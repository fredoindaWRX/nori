import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {nativeStageArguments} from '../scripts/stage-native-payload.mjs'

test('native staging chooses safe named output and rejects silently ignored arguments',()=>{
  assert.deepEqual(nativeStageArguments([]),{candidate:'current'})
  assert.deepEqual(nativeStageArguments(['--candidate=verified-1']),{candidate:'verified-1'})
  assert.deepEqual(nativeStageArguments(['--destination','F:\\nori-build\\native-suite\\NoriSuite']),
    {destination:'F:\\nori-build\\native-suite\\NoriSuite'})
  for(const args of [['--candidate=../escape'],['--candidate=a','--candidate=b'],['--legacy'],['--candidate=']])
    assert.throws(()=>nativeStageArguments(args),/Expected one safe/)
  assert.throws(()=>nativeStageArguments(['--destination','relative']),/absolute --destination/)
  assert.throws(()=>nativeStageArguments(['--destination','F:\\one','extra']),/absolute --destination/)
})
test('suite staging command selects native payload rather than recovered legacy stager',()=>{
  const metadata=JSON.parse(readFileSync(new URL('../package.json',import.meta.url),'utf8'))
  assert.equal(metadata.scripts['stage:suite'],'node scripts/stage-native-payload.mjs')
})
