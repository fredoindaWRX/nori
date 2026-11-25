import test from 'node:test'
import assert from 'node:assert/strict'
import { NEURAL_REGIONS } from '../src/scene/neural-activity.ts'
import { NEURAL_FUNCTIONAL_MAP, NEURAL_REGION_INFO, neuralRegionAtPoint } from '../src/scene/neural-region-info.ts'
test('functional brain map covers the existing sphere without claiming live SoN activations',()=>{
  assert.deepEqual(Object.keys(NEURAL_FUNCTIONAL_MAP),[...NEURAL_REGIONS])
  for(const description of Object.values(NEURAL_FUNCTIONAL_MAP))assert.ok(description.length>0)
  assert.equal(NEURAL_FUNCTIONAL_MAP.planning,'Executive planning')
  assert.equal(NEURAL_FUNCTIONAL_MAP.working_memory,'Active working memory')
  assert.match(NEURAL_REGION_INFO.language.description,/does not expose.*learned neuron activations/)
  assert.match(NEURAL_REGION_INFO.memory.description,/not connected/)
})
test('every selectable region has a plain-language explanation',()=>{
  assert.deepEqual(Object.keys(NEURAL_REGION_INFO),[...NEURAL_REGIONS])
  for(const info of Object.values(NEURAL_REGION_INFO)) {
    assert.ok(info.label.length>0)
    assert.ok(info.description.length>0)
  }
})
test('point selection uses actual region membership and rejects invalid hit indices',()=>{
  const regions=[2,12,9]
  assert.equal(neuralRegionAtPoint(regions,0),'memory')
  assert.equal(neuralRegionAtPoint(regions,1),'working_memory')
  assert.equal(neuralRegionAtPoint(regions,2),'protection')
  for(const index of [-1,3,NaN,Infinity,1.5,'1',undefined])assert.equal(neuralRegionAtPoint(regions,index),null)
  assert.equal(neuralRegionAtPoint([100],0),null)
})
