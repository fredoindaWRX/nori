const test = require('node:test')
const assert = require('node:assert/strict')
const { mkdtempSync, mkdirSync, writeFileSync, rmSync } = require('node:fs')
const { join } = require('node:path')
const { tmpdir } = require('node:os')
const { createMemoryMap, projectVectors } = require('../desktop/memory-map.cjs')

const key = n => n.toString(16).padStart(64, '0')
function vec(seed, bias = 0) { const v = new Float32Array(1024); let s = seed; for (let i = 0; i < 1024; i++) { s = (s * 1103515245 + 12345) & 0x7fffffff; v[i] = (s / 0x7fffffff - 0.5) + (i < 40 ? bias : 0) } return v }
const b64 = v => Buffer.from(v.buffer).toString('base64')
function root(t) { const dir = mkdtempSync(join(tmpdir(), 'nori-memmap-')); t.after(() => rmSync(dir, { recursive: true, force: true })); mkdirSync(join(dir, 'learning')); return dir }

test('each saved memory becomes one unit-length node with a 12-character hash prefix and nothing else', t => {
  const dir = root(t)
  writeFileSync(join(dir, 'learning', 'cue-vectors.json'), JSON.stringify({ model: 'm', vectors: { [key(1)]: b64(vec(1)), [key(2)]: b64(vec(2)), [key(3)]: b64(vec(3)), bad: 'x', [key(4)]: 'AAAA' } }))
  const map = createMemoryMap(dir)()
  assert.equal(map.schema, 'nori.memory-map.v1'); assert.equal(map.count, 3)
  for (const node of map.nodes) {
    assert.deepEqual(Object.keys(node).sort(), ['k', 'p']); assert.match(node.k, /^[a-f0-9]{12}$/)
    assert.ok(Math.abs(Math.hypot(...node.p) - 1) < 1e-3)
  }
  assert.equal(JSON.stringify(map).includes('AAAA'), false)
})

test('similar memories land closer together than unrelated ones, and positions are repeatable', () => {
  const a = vec(11, 3), near = Float32Array.from(a, (x, i) => x + (i % 7 === 0 ? 0.02 : 0)), vectors = { [key(1)]: a, [key(2)]: near }
  for (let i = 0; i < 30; i++) vectors[key(100 + i)] = vec(500 + i)
  const nodes = projectVectors(vectors), again = projectVectors(vectors)
  assert.deepEqual(nodes, again)
  const dist = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2])
  const pair = dist(nodes[0].p, nodes[1].p)
  const others = nodes.slice(2).map(n => dist(nodes[0].p, n.p)).sort((x, y) => x - y)
  assert.ok(pair < others[Math.floor(others.length / 2)], 'near pair ' + pair + ' vs median ' + others[Math.floor(others.length / 2)])
})

test('a missing or broken file gives an empty map, and the recall note passes only hash prefixes', t => {
  const dir = root(t), map = createMemoryMap(dir)
  assert.deepEqual(map(), { schema: 'nori.memory-map.v1', count: 0, nodes: [], recall: null, labels: 'shown' })
  writeFileSync(join(dir, 'learning', 'cue-vectors.json'), '{not json')
  assert.equal(map().count, 0)
  writeFileSync(join(dir, 'learning', 'last-recall.json'), JSON.stringify({ at: 5, keys: ['abcdef012345', 'some memory text', 7] }))
  assert.deepEqual(map().recall, { at: 5, keys: ['abcdef012345'] })
})

test('labels ride along only when allowed; while streaming the page gets no memory text at all', t => {
  const dir = root(t)
  writeFileSync(join(dir, 'learning', 'cue-vectors.json'), JSON.stringify({ model: 'm', vectors: { [key(1)]: b64(vec(1)), [key(2)]: b64(vec(2)) } }))
  writeFileSync(join(dir, 'learning', 'cue-labels.json'), JSON.stringify({ schema: 'nori.memory-labels.v1', labels: { [key(1).slice(0, 12)]: { kind: 'Journal', day: '2026-11-14', title: 'a private line\u0007 here' } } }))
  let live = false
  const map = createMemoryMap(dir, { hideLabels: () => live })
  const shown = map()
  assert.equal(shown.labels, 'shown')
  const labelled = shown.nodes.find(n => n.l)
  assert.deepEqual(labelled.l, { kind: 'Journal', day: '2026-11-14', title: 'a private line  here' })
  live = true
  const hidden = map()
  assert.equal(hidden.labels, 'hidden'); assert.equal(JSON.stringify(hidden).includes('private'), false)
  const broken = createMemoryMap(dir, { hideLabels: () => { throw Error('x') } })()
  assert.equal(broken.labels, 'hidden', 'an unknown streaming state hides labels')
})
