import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {assertNativeSuiteStager} from '../scripts/suite-preflight.mjs'
import {spawnSync} from 'node:child_process'
import {fileURLToPath} from 'node:url'

test('direct legacy staging entry point refuses before source prerequisites',()=>{
  const result=spawnSync(process.execPath,[fileURLToPath(new URL('../scripts/stage-suite.mjs',import.meta.url))],{
    encoding:'utf8', env:{...process.env,NORI_SUITE_SOURCE:'Z:/nonexistent-native-policy-test'}, timeout:5000,
  })
  assert.equal(result.error,undefined)
  assert.equal(result.status,1)
  assert.match(result.stderr,/recovered stager still bundles Ollama/)
  assert.doesNotMatch(result.stderr,/Suite build prerequisites missing/)
})

test('recovered Ollama stager is refused before packaging',()=>{
  const source=readFileSync(new URL('../scripts/stage-suite.mjs',import.meta.url),'utf8')
  assert.throws(()=>assertNativeSuiteStager(source),/nothing staged/)
})
test('native packaging policy detects each known legacy entry point',()=>{
  for(const source of ['copyOllamaModel(', 'process.env.NORI_OLLAMA_HOME', "join(suiteRoot,'ollama')"])
    assert.throws(()=>assertNativeSuiteStager(source),/legacy suite/)
  assert.doesNotThrow(()=>assertNativeSuiteStager('copyNativeRuntime()'))
})
