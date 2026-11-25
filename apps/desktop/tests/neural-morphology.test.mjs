import test from 'node:test'
import assert from 'node:assert/strict'
import * as THREE from 'three'
import { organicSoma, detailedNeuron } from '../src/scene/neural-morphology.ts'

test('organic soma has finite non-spherical surface and computed normals', () => {
  const soma = organicSoma(), positions = soma.getAttribute('position')
  assert.ok(Array.from(positions.array).every(Number.isFinite))
  assert.ok(Array.from(soma.getAttribute('normal').array).every(Number.isFinite))
  const radii = Array.from({length:positions.count}, (_,i) => new THREE.Vector3().fromBufferAttribute(positions,i).length())
  assert.ok(Math.max(...radii) - Math.min(...radii) > .004)
  soma.dispose()
})

test('detailed fibers preserve graph routes and add bounded decorative branches and junctions', () => {
  const nodes = [new THREE.Vector3(),new THREE.Vector3(.2,.1,0),new THREE.Vector3(-.1,.2,.1)]
  const links = [0,1,2,0], copy = [...links]
  const a = detailedNeuron(nodes,links,0), b = detailedNeuron(nodes,links,0)
  assert.deepEqual(a.edges,[0,2]); assert.deepEqual(links,copy)
  assert.equal(a.junctions.length,48)
  assert.ok(a.fibers.getAttribute('position').count > 5000)
  assert.ok(Array.from(a.fibers.getAttribute('position').array).every(Number.isFinite))
  assert.deepEqual(a.fibers.getAttribute('position').array,b.fibers.getAttribute('position').array)
  assert.ok(a.junctions.every(point => point.toArray().every(Number.isFinite)))
  a.fibers.dispose();b.fibers.dispose()
})

test('isolated neuron has no invented functional edge', () => {
  const anatomy = detailedNeuron([new THREE.Vector3()],[],0)
  assert.deepEqual(anatomy.edges,[]);assert.equal(anatomy.junctions.length,0)
  anatomy.fibers.dispose()
  assert.throws(() => detailedNeuron([],[],0), /Unknown neuron/)
})
