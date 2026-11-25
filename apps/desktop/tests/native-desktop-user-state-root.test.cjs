const test=require('node:test')
const assert=require('node:assert/strict')
const {readFileSync}=require('node:fs')
const {resolve}=require('node:path')

test('packaged native Core uses user-writable state when no prepared layout exists',()=>{
  const main=readFileSync(resolve(__dirname,'../desktop/main.cjs'),'utf8')
  const fallback='stateRoot: CONSOLIDATED_STATE?.root || USER_DATA_ROOT'
  assert.equal(main.split(fallback).length-1,2)
  assert.doesNotMatch(main,/stateRoot:\s*CONSOLIDATED_STATE\?\.root\s*\|\|\s*\(PROBE_SESSION\s*\?\s*USER_DATA_ROOT\s*:\s*SUITE_ROOT\)/)
})
