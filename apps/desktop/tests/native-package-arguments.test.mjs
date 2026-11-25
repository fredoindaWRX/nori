import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {nativePackageArguments} from '../scripts/package-native-desktop.mjs'

test('native portable package command retains explicit output and stage identities',()=>{
  assert.deepEqual(nativePackageArguments(['--candidate=release-1','--stageCandidate=verified-1']),
    {candidate:'release-1',stageCandidate:'verified-1'})
  assert.deepEqual(nativePackageArguments([]),{})
  assert.deepEqual(nativePackageArguments(['--stage-path','F:\\nori-stage\\NoriSuite',
    '--output-path','F:\\nori-output']),
  {stagePath:'F:\\nori-stage\\NoriSuite',outputPath:'F:\\nori-output'})
  for(const argumentsList of [['--candidate=../escape'],['--candidate=a','--candidate=b'],
    ['--publish=always'],['--candidate='],['--stageCandidate=a','--stageCandidate=b']])
    assert.throws(()=>nativePackageArguments(argumentsList),/Expected unique safe/)
  assert.throws(()=>nativePackageArguments(['--stage-path']),/absolute native package path/)
  assert.throws(()=>nativePackageArguments(['--output-path','relative']),/absolute native package path/)
  assert.throws(()=>nativePackageArguments(['--stage-path','F:\\one','--stage-path','F:\\two']),
    /absolute native package path/)
})

test('portable Windows command uses the explicit native packager, not a recovered default builder',()=>{
  const metadata=JSON.parse(readFileSync(new URL('../package.json',import.meta.url),'utf8'))
  assert.equal(metadata.scripts['package:windows:dir'],'node scripts/build-renderer.mjs && node scripts/package-native-desktop.mjs')
  assert.doesNotMatch(metadata.scripts['package:windows:dir'],/electron-builder/)
})
