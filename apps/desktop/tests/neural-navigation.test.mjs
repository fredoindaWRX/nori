import test from 'node:test'
import assert from 'node:assert/strict'
import * as THREE from 'three'
import { NEURAL_CAMERA, neuralFocusPose, neuralNavigationScale, neuralIncidentEdges } from '../src/scene/neural-navigation.ts'
import { buildNeuralTopology } from '../src/scene/neural-topology.ts'

test('camera resolves an individual neuron without near-plane clipping', () => {
  assert.ok(NEURAL_CAMERA.minimumDistance < .05)
  assert.ok(NEURAL_CAMERA.near < NEURAL_CAMERA.minimumDistance / 10)
  const point = new THREE.Vector3(.5, -.3, .8)
  const pose = neuralFocusPose(new THREE.Vector3(0, 0, 6.2), new THREE.Vector3(), point)
  assert.ok(pose.target.equals(point))
  assert.ok(Math.abs(pose.position.distanceTo(point) - NEURAL_CAMERA.inspectionDistance) < 1e-12)
  assert.ok(pose.position.clone().sub(point).normalize().equals(new THREE.Vector3(0, 0, 1)))
})
test('close navigation slows and degenerate camera direction stays finite', () => {
  assert.ok(neuralNavigationScale(.14).rotateSpeed < neuralNavigationScale(6.2).rotateSpeed)
  const point = new THREE.Vector3(1, 2, 3)
  const pose = neuralFocusPose(point, point, point)
  assert.deepEqual(point.toArray(), [1, 2, 3])
  assert.ok(pose.position.toArray().every(Number.isFinite))
  assert.throws(() => neuralFocusPose(new THREE.Vector3(NaN, 0, 0), point, point))
})
test('close-up branches preserve actual renderer topology', () => {
  const graph = buildNeuralTopology(), node = 500
  const edges = neuralIncidentEdges(graph.links, node)
  assert.ok(edges.length > 0)
  for (const edge of edges) assert.ok(graph.links[edge] === node || graph.links[edge + 1] === node)
  assert.equal(edges.length, graph.links.filter(value => value === node).length)
  assert.throws(() => neuralIncidentEdges([1], node))
})
