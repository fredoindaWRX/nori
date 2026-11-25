// The city by category (owner, 2026-11-23: "everything inside it should be meaningful, nothing else, and as she
// learns it will grow ... and the way memory and etc is categorized"). Every area of the city is one category of what
// she holds: a kind of memory (conversation, journal, lesson ...) or one of her own groups (Knights, models, skills,
// folders ...). The areas stand round her brain in every direction, since there is no up in here. Nothing is placed
// that does not stand for something; a new memory adds a block to its area, and a new kind adds an area.
// Pure maths, no drawing.
import { BLOCK_GAP } from './memory-city.js'

export const CITY_CENTRE = Object.freeze([0, 0, -18])
const MAX_AREAS = 24
const clean = (value, max) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max)

/** The category a memory belongs to: its kind when the page was given one, else plain "Memories". */
export function categoryOf(node) {
  const kind = clean(node?.l?.kind, 18)
  return kind ? kind[0].toUpperCase() + kind.slice(1).toLowerCase() : 'Memories'
}

/** A compact block of n cells: about as wide as deep as tall. */
export function areaShape(n) {
  const cols = Math.max(1, Math.ceil(Math.cbrt(n))), depth = Math.max(1, Math.ceil(Math.sqrt(n / cols)))
  return { cols, depth, floors: Math.max(1, Math.ceil(n / (cols * depth))) }
}

/** Memories grouped into one area per category. Same plan shape as layoutCity(); areas are placed by arrangeRound(). */
export function layoutByCategory(nodes) {
  const list = (Array.isArray(nodes) ? nodes : []).filter(n => typeof n?.k === 'string' && Array.isArray(n.p) && n.p.length === 3 && n.p.every(Number.isFinite))
  const groups = new Map()
  for (const node of list) { const name = categoryOf(node); if (!groups.has(name)) groups.set(name, []); groups.get(name).push(node) }
  // Biggest first; past the limit the smallest categories share one area, so the count stays readable.
  let named = [...groups.entries()].sort((a, b) => b[1].length - a[1].length || (a[0] < b[0] ? -1 : 1))
  if (named.length > MAX_AREAS) { const rest = named.slice(MAX_AREAS - 1).flatMap(entry => entry[1]); named = [...named.slice(0, MAX_AREAS - 1), ['Other', rest]] }
  const sectors = [], blocks = []
  for (const [title, group] of named) {
    // Stable order inside an area, so a memory keeps its place when others are added.
    group.sort((a, b) => (a.k < b.k ? -1 : a.k > b.k ? 1 : 0))
    const { cols, depth, floors } = areaShape(group.length)
    const sector = { id: sectors.length, center: [0, 0, 0], count: group.length, cols, depth, height: floors * BLOCK_GAP, title }
    group.forEach((node, i) => {
      const column = i % cols, layer = Math.floor(i / cols) % depth, floor = Math.floor(i / (cols * depth))
      blocks.push({ k: node.k, sector: sector.id, pos: [(column - (cols - 1) / 2) * BLOCK_GAP, floor * BLOCK_GAP, -layer * BLOCK_GAP] })
    })
    sectors.push(sector)
  }
  return { sectors, blocks }
}

/**
 * Stands every area of a plan round the centre, evenly in all directions, each far enough out for its size.
 * Moves the areas' blocks with them and records plan.centre. Returns the plan.
 */
export function arrangeRound(plan, centre = CITY_CENTRE) {
  if (!plan || !Array.isArray(plan.sectors) || !Array.isArray(plan.blocks)) return plan
  const K = plan.sectors.length
  const half = sector => Math.hypot(sector.cols, sector.depth, (sector.height || BLOCK_GAP) / BLOCK_GAP) * BLOCK_GAP / 2
  const widest = plan.sectors.reduce((most, sector) => Math.max(most, half(sector)), 0)
  // Room for the brain in the middle, and more room the more areas there are.
  const radius = 4.2 + widest * 1.15 + 0.55 * Math.sqrt(K)
  const shift = new Map()
  plan.sectors.forEach((sector, i) => {
    // Evenly spread directions (a golden-angle spiral over the sphere).
    const y = K > 1 ? 1 - 2 * (i + 0.5) / K : 0, ring = Math.sqrt(Math.max(0, 1 - y * y)), angle = i * 2.399963229728653
    const middle = [centre[0] + Math.cos(angle) * ring * radius, centre[1] + y * radius * 0.8, centre[2] + Math.sin(angle) * ring * radius]
    // sector.center is the front middle of its ground floor; its blocks run back (-z) and up (+y) from there.
    const base = [middle[0], middle[1] - (sector.height || 0) / 2, middle[2] + (sector.depth - 1) * BLOCK_GAP / 2]
    shift.set(sector.id, [base[0] - sector.center[0], base[1] - sector.center[1], base[2] - sector.center[2]])
    sector.center = base; sector.middle = middle
  })
  for (const block of plan.blocks) { const d = shift.get(block.sector); if (d) block.pos = [block.pos[0] + d[0], block.pos[1] + d[1], block.pos[2] + d[2]] }
  plan.centre = [centre[0], centre[1], centre[2]]; plan.radius = radius
  return plan
}
