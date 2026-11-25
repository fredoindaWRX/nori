// Lays out the city inside Nori from her real memory nodes (vision doc parts 2, 4 and 6): every memory is one
// block, and memories close in meaning share a district. Pure maths, no drawing, so it can be tested in Node.
// Input nodes are { k: hash prefix, p: [x, y, z] unit direction } from desktop/memory-map.cjs. No text exists here.

const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const unit = v => { const m = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / m, v[1] / m, v[2] / m] }
const hashUnit = (k, salt) => (parseInt(k.slice(salt, salt + 4), 16) % 1000) / 1000

export const BLOCK_GAP = 0.52          // spacing between neighbouring blocks in a district
export const PER_DISTRICT = 12         // roughly how many memories share a district

// Group directions into districts (k-means on the sphere). Deterministic: the same memories give the same city.
export function districts(nodes, wanted) {
  const n = nodes.length
  if (!n) return { centers: [], assign: [] }
  const k = Math.max(1, Math.min(wanted ?? Math.round(n / PER_DISTRICT), 24, n))
  // Start from spread-out memories: the first, then repeatedly the one farthest from every chosen centre.
  const centers = [unit(nodes[0].p)]
  while (centers.length < k) {
    let best = -1, worst = 2
    for (let i = 0; i < n; i++) { const near = Math.max(...centers.map(c => dot(c, nodes[i].p))); if (near < worst) { worst = near; best = i } }
    centers.push(unit(nodes[best].p))
  }
  let assign = new Array(n).fill(0)
  for (let round = 0; round < 10; round++) {
    assign = nodes.map(node => { let best = 0, score = -2; centers.forEach((c, i) => { const s = dot(c, node.p); if (s > score) { score = s; best = i } }); return best })
    const sums = centers.map(() => [0, 0, 0])
    nodes.forEach((node, i) => { const s = sums[assign[i]]; s[0] += node.p[0]; s[1] += node.p[1]; s[2] += node.p[2] })
    sums.forEach((s, i) => { if (s[0] || s[1] || s[2]) centers[i] = unit(s) })
  }
  return { centers, assign }
}

// Where each district stands in the space the dive flies through: off to the sides of a central avenue,
// near districts close to the entrance and far ones deep inside.
export function districtPosition(center) {
  const side = Math.hypot(center[0], center[1])
  // A district pointing straight along the avenue has no side of its own: put it to the right.
  const sx = side > 1e-6 ? center[0] / side : 1, sy = side > 1e-6 ? center[1] / side : 0
  const reach = 2.8 + 3.4 * Math.min(1, side)                 // never on the avenue itself
  return [sx * reach, sy * reach * 0.6, -7 - (center[2] + 1) * 11]
}

export function layoutCity(nodes) {
  const list = (Array.isArray(nodes) ? nodes : []).filter(n => typeof n?.k === 'string' && Array.isArray(n.p) && n.p.length === 3 && n.p.every(Number.isFinite))
    .map(n => ({ k: n.k, p: unit(n.p) }))
  const { centers, assign } = districts(list)
  const members = centers.map(() => [])
  list.forEach((node, i) => members[assign[i]].push(node))
  const sectors = [], blocks = []
  centers.forEach((center, id) => {
    const group = members[id]
    if (!group.length) return
    // Stable order inside a district, so a memory keeps its block when others are added elsewhere.
    group.sort((a, b) => (a.k < b.k ? -1 : a.k > b.k ? 1 : 0))
    const base = districtPosition(center), cols = Math.ceil(Math.sqrt(group.length)), depth = Math.max(1, Math.ceil(cols / 2))
    const sector = { id: sectors.length, center: base, count: group.length, cols, depth }
    group.forEach((node, i) => {
      const column = i % cols, layer = Math.floor(i / cols) % depth, floor = Math.floor(i / (cols * depth))
      blocks.push({ k: node.k, sector: sector.id, pos: [
        base[0] + (column - (cols - 1) / 2) * BLOCK_GAP,
        base[1] + floor * BLOCK_GAP + hashUnit(node.k, 0) * 0.04,
        base[2] - layer * BLOCK_GAP,
      ] })
    })
    sector.height = Math.ceil(group.length / (cols * depth)) * BLOCK_GAP
    sectors.push(sector)
  })
  return { sectors, blocks }
}

// What makes two memory maps different for the city: whether labels are shown or hidden (OBS), how many, and which.
// The page rebuilds the city when this changes, so hiding labels takes effect even when the memories are the same.
export const mapStamp = map => (map.labels || "") + ":" + map.count + ":" + (map.nodes[0]?.k || "") + ":" + (map.nodes[map.nodes.length - 1]?.k || "")
