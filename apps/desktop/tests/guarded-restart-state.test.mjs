import test from 'node:test'
import assert from 'node:assert/strict'
import {createGuardedRestartRegistry} from '../scripts/guarded-restart-state.mjs'
const readiness={fixture:'original-synthetic-job',sha256:'a'.repeat(64)}
test('only original same-process capability grants a cycle; clones and other registries refuse',()=>{
  const registry=createGuardedRestartRegistry(),handle=registry.issue({layoutRoot:'synthetic'})
  assert.equal(Object.isFrozen(handle),true)
  for(const invalid of [undefined,null,{},structuredClone(handle),JSON.parse(JSON.stringify(handle))])
    assert.throws(()=>registry.begin(invalid),/process-local/)
  assert.throws(()=>createGuardedRestartRegistry().begin(handle),/process-local/)
  const cycle=registry.begin(handle);assert.equal(cycle.cycle,0);cycle.finish(false)
})
test('active/reentrant reuse refuses and successful captured drain advances once without reseeding',()=>{
  const registry=createGuardedRestartRegistry(),input={markers:{fixture:'original'}},handle=registry.issue(input)
  input.markers.fixture='changed'
  const first=registry.begin(handle)
  assert.equal(first.data.markers.fixture,'original');assert.equal(Object.isFrozen(first.data.markers),true)
  assert.throws(()=>registry.begin(handle),/active/)
  first.finish(true,readiness)
  assert.throws(()=>first.finish(true,readiness),/finalized/)
  const second=registry.begin(handle)
  assert.equal(second.cycle,1);assert.deepEqual(second.previousReadiness,readiness)
  assert.equal(Object.isFrozen(second.previousReadiness),true)
  second.finish(true,{...readiness,fixture:'second'})
  const third=registry.begin(handle);assert.equal(third.cycle,2);third.finish(false)
  assert.throws(()=>registry.begin(handle),/poisoned/)
})
test('failure or incomplete success permanently poisons the capability and cannot be revived',()=>{
  for(const invalid of [undefined,{fixture:'job',sha256:'bad'},{sha256:'a'.repeat(64)}]){
    const registry=createGuardedRestartRegistry(),handle=registry.issue({})
    const cycle=registry.begin(handle)
    assert.throws(()=>cycle.finish(true,invalid),/captured readiness/)
    assert.throws(()=>registry.begin(handle),/poisoned/)
    assert.throws(()=>cycle.finish(true,readiness),/finalized/)
  }
  const registry=createGuardedRestartRegistry(),handle=registry.issue({})
  registry.begin(handle).finish('truthy',readiness)
  assert.throws(()=>registry.begin(handle),/poisoned/)
})
