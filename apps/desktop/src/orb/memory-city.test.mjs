import test from 'node:test'
import assert from 'node:assert/strict'
import { layoutCity, districts, districtPosition, BLOCK_GAP } from './memory-city.js'

const unit = v => { const m = Math.hypot(...v); return v.map(x => x / m) }
function nodes(n, seed = 7) { const out = []; let s = seed; const r = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff * 2 - 1 }
  for (let i = 0; i < n; i++) out.push({ k: (i * 2654435761 >>> 0).toString(16).padStart(8, '0') + 'abcd', p: unit([r(), r(), r()]) }); return out }

test('every real memory gets exactly one block, and no two blocks share a spot', () => {
  const list = nodes(201), city = layoutCity(list)
  assert.equal(city.blocks.length, 201)
  assert.deepEqual(city.blocks.map(b => b.k).sort(), list.map(n => n.k).sort())
  assert.equal(city.sectors.reduce((sum, s) => sum + s.count, 0), 201)
  const spots = new Set(city.blocks.map(b => b.pos.map(x => Math.round(x / (BLOCK_GAP / 4))).join(',')))
  assert.equal(spots.size, 201)
})
test('the same memories always give the same city', () => {
  assert.deepEqual(layoutCity(nodes(90)), layoutCity(nodes(90)))
})
test('memories close in meaning share a district; far ones do not', () => {
  const a = unit([1, 0.02, 0]), b = unit([1, 0, 0.03]), far = unit([-1, 0.1, 0]), list = [{ k: 'aaaaaaaa0001', p: a }, { k: 'aaaaaaaa0002', p: b }, { k: 'aaaaaaaa0003', p: far }, ...nodes(40, 3)]
  const { assign } = districts(list)
  assert.equal(assign[0], assign[1]); assert.notEqual(assign[0], assign[2])
})
test('districts stand off the central avenue, deeper for directions facing away', () => {
  for (const c of [[0, 0, 1], [1, 0, 0], [0, 1, 0], [0.01, 0, -1]]) {
    const p = districtPosition(unit(c)); assert.ok(Math.hypot(p[0], p[1] / 0.6) >= 2.79, JSON.stringify(p)); assert.ok(p[2] <= -7 && p[2] >= -29.01)
  }
  assert.ok(districtPosition([0, 0, 1])[2] < districtPosition([0, 0, -1])[2])
})
test('one memory, none, and junk input all work', () => {
  assert.equal(layoutCity([{ k: 'abcdef012345', p: [0, 0, 1] }]).blocks.length, 1)
  assert.deepEqual(layoutCity([]), { sectors: [], blocks: [] })
  assert.deepEqual(layoutCity([{ k: 5, p: [1, 0, 0] }, { k: 'x', p: [1, NaN, 0] }, null]), { sectors: [], blocks: [] })
})
import { labelLines, assembly } from './city-detail.js'
test('a block sign shows the memory when labels are allowed, and only its code otherwise', () => {
  assert.deepEqual(labelLines({ k: '0be291d0db5f', l: { kind: 'Journal', day: '2026-11-14', title: 'I care how she looks' } }),
    { top: 'JOURNAL · 2026-11-14 · 0BE291D0DB5F', title: 'I care how she looks' })
  assert.deepEqual(labelLines({ k: '0be291d0db5f' }), { top: 'MEMORY · 0BE291D0DB5F', title: '' })
})
test('blocks assemble as the camera nears them', () => {
  assert.equal(assembly(2), 1); assert.equal(assembly(40), 0)
  assert.ok(assembly(8) > assembly(12) && assembly(12) > 0)
})
import { structureCells, AVENUE_CLEAR, KIND } from './city-structure.js'
test('the megastructure is repeatable, keeps the flight path clear, and is mostly dark with a few lit blocks', () => {
  const a = structureCells(6000), b = structureCells(6000)
  assert.equal(a.count, 6000); assert.deepEqual(Array.from(a.position.slice(0, 300)), Array.from(b.position.slice(0, 300)))
  let lit = 0, warm = 0
  for (let i = 0; i < a.count; i++) {
    const axis = Math.hypot(a.position[i * 3] / 1.25, a.position[i * 3 + 1] / 0.72)
    assert.ok(axis >= AVENUE_CLEAR - 1e-4, 'block ' + i + ' at ' + axis)
    assert.ok(a.scale[i * 3] > 0 && a.scale[i * 3 + 1] > 0 && a.scale[i * 3 + 2] > 0)
    if (a.kind[i] !== KIND.dark) lit++
    if (a.kind[i] === KIND.warm) warm++
  }
  assert.ok(lit / a.count > 0.12 && lit / a.count < 0.26, 'lit share ' + lit / a.count)
  assert.ok(warm > 0 && warm < lit)
  assert.equal(structureCells(0).count, 0)
})
import { crumple, tracePath } from './figure.js'
test('the membrane is crumpled but stays a closed shape around the core', () => {
  let lo = 9, hi = 0
  for (let i = 0; i < 4000; i++) { const a = i * 2.399963, y = 1 - 2 * (i + 0.5) / 4000, r = Math.sqrt(1 - y * y), v = crumple(Math.cos(a) * r, y, Math.sin(a) * r); lo = Math.min(lo, v); hi = Math.max(hi, v) }
  assert.ok(lo > 0.55 && hi < 1.5, lo + '..' + hi); assert.ok(hi - lo > 0.25, 'has real folds')
  assert.equal(crumple(0.3, 0.4, 0.5), crumple(0.3, 0.4, 0.5))
})
test('circuit traces stay on their sphere and turn at right angles', () => {
  let s = 5; const rand = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff }
  const path = tracePath(rand, 1.2)
  assert.equal(path.length, 10)
  for (const p of path) assert.ok(Math.abs(Math.hypot(...p) - 1.2) < 1e-9)
})

test('the lit district and the structure glow line up with their blocks', async () => {
  const { districtCells } = await import('./city-detail.js')
  const { structureCells } = await import('./city-structure.js')
  const { layoutCity } = await import('./memory-city.js')
  const nodes = Array.from({ length: 40 }, (_, i) => ({ k: i.toString(16).padStart(8, '0'), p: [Math.sin(i), Math.cos(i * 1.3), Math.sin(i * 0.7 + 1)] }))
  const plan = layoutCity(nodes), cells = districtCells(plan, plan.blocks)
  assert.ok(cells.count > plan.blocks.length * 2)
  for (const key of ['kind', 'seed', 'glow']) assert.equal(cells[key].length, cells.count)
  assert.equal(cells.position.length, cells.count * 3); assert.equal(cells.scale.length, cells.count * 3)
  assert.ok(cells.scale.every(v => v > 0))
  const wall = structureCells(3000)
  assert.equal(wall.glow.length, wall.count)
})
