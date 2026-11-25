import test from 'node:test'
import assert from 'node:assert/strict'
import { buildNeuralTopology } from '../src/scene/neural-topology.ts'
import { NEURAL_REGIONS, NEURAL_CENTERS } from '../src/scene/neural-activity.ts'
import { NEURAL_TRANSPORT_DESTINATIONS } from '../src/scene/neural-signals.ts'

test('actual renderer graph gives every region finite nodes inside the sphere',()=>{
  const graph=buildNeuralTopology()
  assert.equal(NEURAL_CENTERS.length,NEURAL_REGIONS.length)
  assert.equal(graph.nodes.length,1677)
  assert.equal(graph.positions.length,graph.nodes.length*3)
  assert.ok(graph.positions.every(Number.isFinite))
  assert.ok(graph.nodes.every(node=>node.length()<=1.4800000001))
  for(let region=0;region<NEURAL_REGIONS.length;region++) assert.equal(graph.regions.filter(value=>value===region).length,129)
  assert.equal(graph.links.length%2,0)
  assert.ok(graph.links.every(index=>Number.isInteger(index)&&index>=0&&index<graph.nodes.length))
})
test('all six accepted telemetry destinations have directed transport fibers',()=>{
  const graph=buildNeuralTopology()
  for(const destination of NEURAL_TRANSPORT_DESTINATIONS) {
    let found=false
    for(let i=0;i<graph.links.length;i+=2) {
      if(NEURAL_REGIONS[graph.regions[graph.links[i]]]==='connections'
        && NEURAL_REGIONS[graph.regions[graph.links[i+1]]]===destination)found=true
    }
    assert.ok(found,destination)
  }
})
test('region membership and fiber graph are reproducible across mounts',()=>{
  const first=buildNeuralTopology(),second=buildNeuralTopology()
  assert.deepEqual(first.positions,second.positions)
  assert.deepEqual(first.regions,second.regions)
  assert.deepEqual(first.links,second.links)
})
