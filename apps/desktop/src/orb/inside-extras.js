// Districts for what is inside her besides memories: her Knights, brains, connected systems, skills, her own folders
// and the projects she can work in (desktop/inside-map.cjs supplies the items). Pure maths, no drawing.
// Each group becomes one district of blocks, placed round the avenue further out than the memory districts, and each
// item one block that the explore window can summon like a memory.
import { BLOCK_GAP, districtPosition } from './memory-city.js'

const GOLDEN = 2.399963229728653
// Block keys are 12 hex characters everywhere in the city; derive a stable one from the item's id.
export function extraKey(id) {
  let a = 0x811c9dc5, b = 0x01000193
  for (const ch of String(id)) { a = Math.imul(a ^ ch.charCodeAt(0), 0x01000193) >>> 0; b = Math.imul(b + ch.charCodeAt(0), 0x85ebca6b) >>> 0 }
  return (a.toString(16).padStart(8, '0') + b.toString(16).padStart(8, '0')).slice(0, 12)
}

const text = (value, max) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max)

/** Adds one district per group to a city plan from layoutCity(). Returns how many blocks were added. */
export function appendExtras(plan, groups) {
  if (!plan || !Array.isArray(plan.sectors) || !Array.isArray(plan.blocks)) return 0
  const list = (Array.isArray(groups) ? groups : []).filter(group => group && Array.isArray(group.items) && group.items.length).slice(0, 10)
  const taken = new Set(plan.blocks.map(block => block.k))
  let added = 0
  list.forEach((group, g) => {
    const items = group.items.filter(item => item && typeof item.id === 'string' && typeof item.title === 'string').slice(0, 80)
    if (!items.length) return
    // Spread the groups round the avenue and along it, a little further out than any memory district.
    const angle = g * GOLDEN, along = list.length > 1 ? -0.85 + 1.7 * g / (list.length - 1) : 0
    const base = districtPosition([Math.cos(angle), Math.sin(angle), along])
    base[0] *= 1.45; base[1] *= 1.45
    const cols = Math.ceil(Math.sqrt(items.length)), depth = Math.max(1, Math.ceil(cols / 2))
    const sector = { id: plan.sectors.length, center: base, count: items.length, cols, depth, title: text(group.title, 60), extra: true }
    items.forEach((item, i) => {
      let k = extraKey(item.id)
      while (taken.has(k)) k = extraKey(k + '+')
      taken.add(k)
      const column = i % cols, layer = Math.floor(i / cols) % depth, floor = Math.floor(i / (cols * depth))
      plan.blocks.push({ k, sector: sector.id,
        pos: [base[0] + (column - (cols - 1) / 2) * BLOCK_GAP, base[1] + floor * BLOCK_GAP, base[2] - layer * BLOCK_GAP],
        l: { kind: text(item.kind, 24), day: '', title: text(item.title, 80) },
        x: { id: item.id, group: sector.title, rows: (Array.isArray(item.rows) ? item.rows : []).filter(row => Array.isArray(row) && row.length === 2).slice(0, 6).map(row => [text(row[0], 14), text(row[1], 110)]), ask: text(item.ask, 200) } })
      added++
    })
    sector.height = Math.ceil(items.length / (cols * depth)) * BLOCK_GAP
    plan.sectors.push(sector)
  })
  return added
}
