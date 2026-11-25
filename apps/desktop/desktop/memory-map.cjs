// Turns Nori's saved memory vectors into positions for her face (vision doc part 4): one node per real
// memory, placed so memories close in meaning sit close together on the sphere.
// Privacy: the page receives directions and 12-character hash prefixes only. No memory text, no vectors.
// Read-only: this never writes to her learning folder.
const { readFileSync, statSync } = require('node:fs')
const { join } = require('node:path')

const DIMENSIONS = 1024, MAX_NODES = 3000
const KEY = /^[a-f0-9]{64}$/

// A fixed 3 x 1024 projection, so the same memory always lands in the same place.
function mulberry(seed) {
  return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296 }
}
const PROJECTION = (() => {
  const random = mulberry(0x4e4f5249), rows = []
  for (let r = 0; r < 3; r++) { const row = new Float32Array(DIMENSIONS); for (let i = 0; i < DIMENSIONS; i++) row[i] = random() * 2 - 1; rows.push(row) }
  return rows
})()

function decode(b64) {
  if (typeof b64 !== 'string') return null
  const bytes = Buffer.from(b64, 'base64')
  if (bytes.length !== DIMENSIONS * 4) return null
  return new Float32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length))
}

// vectors: { key: Float32Array } -> [{ k, p: [x, y, z] }] with unit-length p.
function projectVectors(vectors) {
  const entries = Object.entries(vectors).filter(([key, v]) => KEY.test(key) && v && v.length === DIMENSIONS).slice(-MAX_NODES)
  if (!entries.length) return []
  // Embeddings share a large common part; removing the average spreads the memories around the sphere.
  const mean = new Float64Array(DIMENSIONS)
  for (const [, v] of entries) for (let i = 0; i < DIMENSIONS; i++) mean[i] += v[i]
  for (let i = 0; i < DIMENSIONS; i++) mean[i] /= entries.length
  return entries.map(([key, v]) => {
    const p = [0, 0, 0]
    for (let r = 0; r < 3; r++) { let sum = 0; const row = PROJECTION[r]; for (let i = 0; i < DIMENSIONS; i++) sum += row[i] * (v[i] - mean[i]); p[r] = sum }
    const length = Math.hypot(p[0], p[1], p[2])
    // A lone memory (or one equal to the average) has no direction of its own; give it a stable one from its key.
    const unit = length > 1e-9 ? p.map(x => x / length) : (() => { const r = mulberry(parseInt(key.slice(0, 8), 16)); const d = [r() * 2 - 1, r() * 2 - 1, r() * 2 - 1]; const l = Math.hypot(...d) || 1; return d.map(x => x / l) })()
    return { k: key.slice(0, 12), p: unit.map(x => Math.round(x * 10000) / 10000) }
  })
}

function readRecall(dataRoot) {
  try {
    const saved = JSON.parse(readFileSync(join(dataRoot, 'learning', 'last-recall.json'), 'utf8'))
    const at = Number(saved.at)
    if (!Number.isFinite(at) || !Array.isArray(saved.keys)) return null
    return { at, keys: saved.keys.filter(k => typeof k === 'string' && /^[a-f0-9]{12}$/.test(k)).slice(0, 12) }
  } catch { return null }
}

function readLabels(dataRoot) {
  try {
    const saved = JSON.parse(readFileSync(join(dataRoot, 'learning', 'cue-labels.json'), 'utf8'))
    return saved?.schema === 'nori.memory-labels.v1' && saved.labels && typeof saved.labels === 'object' ? saved.labels : {}
  } catch { return {} }
}
const clean = (value, max) => String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, max)

// hideLabels(): true while the owner is streaming (OBS) so her memory text never reaches a broadcast page.
function createMemoryMap(dataRoot, { hideLabels = () => false } = {}) {
  const file = join(dataRoot, 'learning', 'cue-vectors.json')
  let stamp = '', nodes = []
  return function memoryMap() {
    try {
      const stat = statSync(file), next = stat.mtimeMs + ':' + stat.size
      if (next !== stamp) {
        const saved = JSON.parse(readFileSync(file, 'utf8')), vectors = {}
        if (saved && typeof saved.vectors === 'object' && saved.vectors) {
          for (const [key, b64] of Object.entries(saved.vectors)) { const v = decode(b64); if (v) vectors[key] = v }
        }
        nodes = projectVectors(vectors); stamp = next
      }
    } catch { if (!stamp) nodes = [] } // no file yet, or mid-write: keep the last good map
    let hidden = true
    try { hidden = Boolean(hideLabels()) } catch {}
    if (hidden) return { schema: 'nori.memory-map.v1', count: nodes.length, nodes, recall: readRecall(dataRoot), labels: 'hidden' }
    const labels = readLabels(dataRoot)
    const labelled = nodes.map(node => {
      const l = labels[node.k]
      return l ? { ...node, l: { kind: clean(l.kind, 24), day: clean(l.day, 10), title: clean(l.title, 80) } } : node
    })
    return { schema: 'nori.memory-map.v1', count: nodes.length, nodes: labelled, recall: readRecall(dataRoot), labels: 'shown' }
  }
}

module.exports = { createMemoryMap, projectVectors, readRecall }
