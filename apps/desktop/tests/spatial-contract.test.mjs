import test from 'node:test'
import assert from 'node:assert/strict'
import { encodeSpatialFrame, parseSpatialLayout, SPATIAL_LAYOUT_KEY, SPATIAL_NODE_OPCODES, SPATIAL_SCHEMA } from '../src/workspace/spatial-contract.ts'
import { MODEL_CATALOG_CANDIDATES } from '../src/workspace/model-catalog.ts'

const node = (id, kind = 'core', overrides = {}) => ({
  id, kind, title: id, status: 'LIVE', room: 'CORE', x: .5, y: .5, z: 0,
  detail: 'Observed desktop state.', origin: 'nori_live', ...overrides,
})

test('spatial Neuralese encodes registered object opcodes, slot cells, edges, and no authority', () => {
  const frame = encodeSpatialFrame([
    node('core'),
    node('local-model', 'model', { room: 'CORE' }),
    node('surface:receipt', 'surface', { room: 'WORK', sourceId: 'receipt' }),
    node('note:1', 'note', { room: 'NOTES', origin: 'user_local', status: 'LOCAL NOTE' }),
    node('project:1', 'project', { room: 'WORK', origin: 'nori_project', status: 'LOCAL FILE' }),
  ], [
    { from: 'core', relation: 'uses', to: 'local-model' },
    { from: 'core', relation: 'opens', to: 'surface:receipt' },
    { from: 'core', relation: 'contains', to: 'note:1' },
  ])
  assert.equal(frame.schema, SPATIAL_SCHEMA)
  assert.equal(frame.nodes[1][1], SPATIAL_NODE_OPCODES.model)
  assert.equal(frame.nodes[4][1], SPATIAL_NODE_OPCODES.project)
  assert.equal(frame.nodes[4][3], 3)
  assert.deepEqual(frame.nodes[1][2].slice(3, 6), [5000, 5000, 0])
  assert.deepEqual(frame.edges.map((edge) => edge[0] !== edge[2]), [true, true, true])
  assert.deepEqual(frame.unresolved_fields, [])
  assert.deepEqual(frame.translation_losses, [])
  assert.equal(frame.execution_authorized, false)
})

test('Qwen3.6 is selectable as a catalog candidate without claiming runtime readiness', () => {
  const qwen = MODEL_CATALOG_CANDIDATES.find((item) => item.id === 'model-candidate-qwen36')
  assert.ok(qwen)
  assert.equal(qwen.title, 'Qwen3.6-35B-A3B')
  assert.equal(qwen.room, 'MODELS')
  assert.equal(qwen.status, 'CANDIDATE · NOT LOADED')
  assert.match(qwen.detail, /35B total parameters, 3B active/)
  assert.match(qwen.detail, /no qualified Qwen runtime adapter or installed weights/)
  assert.match(qwen.detail, /unverified/)
  assert.match(qwen.detail, /not measurements on this PC/)
  assert.equal(qwen.sourceId, 'https://huggingface.co/Qwen/Qwen3.6-35B-A3B')
})

test('spatial Neuralese rejects unknown kinds, malformed edges, duplicate IDs, and unbounded coordinates', () => {
  assert.throws(() => encodeSpatialFrame([node('x', 'toString')], []), /opcode/)
  assert.throws(() => encodeSpatialFrame([node('x'), node('x')], []), /duplicate/)
  assert.throws(() => encodeSpatialFrame([node('x', 'core', { x: 3 })], []), /coordinates/)
  assert.throws(() => encodeSpatialFrame([node('x')], [{ from: 'x', relation: 'opens', to: 'missing' }]), /missing/)
  assert.throws(() => encodeSpatialFrame([node('x', 'project', { origin: 'unknown' })], []), /provenance/)
})

test('spatial layout storage is local, versioned, and validated on restore', () => {
  const source = {
    version: 1, room: 'NOTES', positions: { 'nori-core': { x: .7, y: .4, z: 1 } },
    notes: [node('note:abc-123', 'note', { title: 'Idea', room: 'NOTES', status: 'LOCAL NOTE', detail: 'Private local note.', origin: 'user_local', x: .4, y: .6 })],
  }
  const restored = parseSpatialLayout(JSON.stringify(source))
  assert.equal(restored.room, 'NOTES')
  assert.deepEqual(restored.positions['nori-core'], { x: .7, y: .4, z: 1 })
  assert.equal(restored.notes[0].detail, 'Private local note.')
  assert.equal(SPATIAL_LAYOUT_KEY, 'nori.spatialWorkspace.v1')
  assert.equal(parseSpatialLayout(null).room, 'CORE')
  assert.throws(() => parseSpatialLayout('{'), SyntaxError)
  assert.throws(() => parseSpatialLayout(JSON.stringify({ ...source, version: 2 })), /unsupported/)
  assert.throws(() => parseSpatialLayout(JSON.stringify({ ...source, positions: { 'nori-core': { x: 9, y: .5, z: 0 } } })), /placement/)
  assert.throws(() => parseSpatialLayout(JSON.stringify({ ...source, positions: { 'nori-core': { x: .5, y: .5, z: 0, hidden: true } } })), /placement/)
  assert.throws(() => parseSpatialLayout(JSON.stringify({ ...source, positions: { 'nori-core': { x: .5, y: .5, z: 0 } }, unexpected: 'must not be silently dropped' })), /unmapped fields/)
  assert.throws(() => parseSpatialLayout(JSON.stringify({ ...source, notes: [{ ...source.notes[0], origin: 'nori_live' }] })), /note/)
  assert.throws(() => parseSpatialLayout(JSON.stringify({ ...source, notes: [{ ...source.notes[0], trust: 'unexpected' }] })), /unmapped note fields/)
  assert.equal(parseSpatialLayout(JSON.stringify({ ...source, room: 'MODELS' })).room, 'MODELS')
})
