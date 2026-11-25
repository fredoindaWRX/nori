import test from 'node:test'
import assert from 'node:assert/strict'
import { appendExtras, extraKey } from './inside-extras.js'
import { layoutCity } from './memory-city.js'
import { askText, findMemories } from './city-explore.js'

const nodes = Array.from({ length: 60 }, (_, i) => ({ k: (i * 2654435761 >>> 0).toString(16).padStart(8, '0') + 'abcd', p: [Math.cos(i), Math.sin(i), Math.sin(i * 0.7)] }))
const groups = [
  { id: 'knights', title: 'Her Knights', items: Array.from({ length: 12 }, (_, i) => ({ id: `knights:k${i}`, title: `Knight ${i}`, kind: 'knight', rows: [['role', `role ${i}`]], ask: `What does Knight ${i} do?` })) },
  { id: 'systems', title: 'Connected systems', items: [{ id: 'systems:zapier', title: 'Your apps through Zapier', kind: 'connector', rows: [['token', 'saved'], ['bad row'], 'junk'], ask: 'What connected apps do you have?' }] },
  { id: 'empty', title: 'Nothing', items: [] },
]

test('each group becomes its own district of blocks beside the memory districts', () => {
  const plan = layoutCity(nodes), memories = plan.blocks.length, sectors = plan.sectors.length
  assert.equal(appendExtras(plan, groups), 13)
  assert.equal(plan.blocks.length, memories + 13); assert.equal(plan.sectors.length, sectors + 2)
  const added = plan.blocks.slice(memories)
  for (const block of added) {
    assert.match(block.k, /^[a-f0-9]{12}$/); assert.ok(block.pos.every(Number.isFinite)); assert.ok(block.x && block.l.title)
    assert.ok(plan.sectors[block.sector].extra)
    // Never on the avenue the camera flies along.
    assert.ok(Math.hypot(block.pos[0], block.pos[1]) > 2.5, JSON.stringify(block.pos))
  }
  assert.equal(new Set(plan.blocks.map(block => block.k)).size, plan.blocks.length, 'keys stay unique across memories and extras')
  assert.equal(plan.sectors.at(-2).title, 'Her Knights'); assert.equal(plan.sectors.at(-2).count, 12)
  const zapier = added.at(-1)
  assert.deepEqual(zapier.x.rows, [['token', 'saved']], 'malformed rows are dropped')
  assert.equal(zapier.l.kind, 'connector')
  // No two blocks share a place.
  const places = new Set(plan.blocks.map(block => block.pos.map(v => v.toFixed(2)).join(',')))
  assert.equal(places.size, plan.blocks.length)
})

test('keys are stable, and a bad plan or bad groups add nothing', () => {
  assert.equal(extraKey('systems:zapier'), extraKey('systems:zapier')); assert.notEqual(extraKey('systems:zapier'), extraKey('systems:hue'))
  assert.equal(appendExtras(null, groups), 0)
  const plan = layoutCity(nodes), before = plan.blocks.length
  assert.equal(appendExtras(plan, 'nonsense'), 0); assert.equal(appendExtras(plan, [{ id: 'x', title: 'y', items: [{ id: 5 }, null] }]), 0)
  assert.equal(plan.blocks.length, before)
  const big = layoutCity(nodes)
  assert.equal(appendExtras(big, [{ id: 'g', title: 'G', items: Array.from({ length: 300 }, (_, i) => ({ id: `g:${i}`, title: `t${i}`, kind: 'file', rows: [] })) }]), 80, 'a group is capped')
})

test('the window finds and asks about files and systems like memories', () => {
  const plan = layoutCity(nodes); appendExtras(plan, groups)
  const hits = findMemories(plan.blocks, 'zapier')
  assert.equal(hits.length, 1); assert.equal(plan.blocks[hits[0]].x.id, 'systems:zapier')
  assert.equal(askText(plan.blocks[hits[0]]), 'What connected apps do you have?')
  assert.equal(askText({ x: { ask: '' }, l: { title: 'secrets' } }), '', 'an item with no question offers no Ask button')
  assert.ok(findMemories(plan.blocks, 'knight').length >= 8)
})
