import test from 'node:test'
import assert from 'node:assert/strict'
import {assertRequiredFiles,suiteSourceFiles} from '../scripts/suite-preflight.mjs'
test('suite preflight reports all absent inputs before staging',()=>{
  assert.throws(()=>assertRequiredFiles(['nori-absent-source-1','nori-absent-source-2']),error=>error.message.includes('nothing staged')&&error.message.includes('nori-absent-source-1')&&error.message.includes('nori-absent-source-2'))
})
test('suite preflight accepts real files but rejects directories',()=>{
  assert.doesNotThrow(()=>assertRequiredFiles([new URL('../package.json',import.meta.url)]))
  assert.throws(()=>assertRequiredFiles([new URL('../scripts/',import.meta.url)]))
  assert.equal(suiteSourceFiles('app','suite').length,11)
})
