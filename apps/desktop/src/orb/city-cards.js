// What shows on the glass faces of the blocks inside her (owner, 2026-11-17: "see thru glass type with alternating
// images of what is inside of that block"). Every block gets a few small cards drawn from what it is: a picture for
// its kind (a conversation, a journal page, a Knight, a model, a folder, a score...) and a card with its own words.
// The cards live in one atlas texture; the block shader (city-detail.js) alternates them on each face.
// Only what the page already has is drawn: kind, day, title, and the few facts of a file or system block.

export const ATLAS = 8192, TILE = 256, GRID = ATLAS / TILE, SLOTS = GRID * GRID
/** How many cards each block gets so that all of them fit in the atlas. */
export const cardsPerBlock = count => Math.max(1, Math.min(3, Math.floor(SLOTS / Math.max(1, count))))

const FAMILY = [
  [/knight/, 'knight'], [/model|cloud|brain/, 'model'], [/connector|device|integration|service/, 'system'], [/skill/, 'skill'],
  [/folder/, 'folder'], [/project/, 'project'], [/score/, 'score'], [/journal|note|lesson|reflection/, 'page'], [/conversation|exchange|chat|talk/, 'talk'],
]
/** Which picture a block gets. Pure. */
export function cardFamily(block) {
  const kind = String(block?.l?.kind ?? '').toLowerCase()
  for (const [pattern, family] of FAMILY) if (pattern.test(kind)) return family
  return block?.x ? 'system' : 'memory'
}
/** The words on a block's text card: a heading and up to four short lines. Pure. */
export function cardText(block) {
  const clean = (value, max) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max)
  const kind = clean(block?.l?.kind, 18) || 'memory', title = clean(block?.l?.title, 120)
  if (block?.x) return { head: kind.toUpperCase(), lines: [title, ...(Array.isArray(block.x.rows) ? block.x.rows : []).slice(0, 3).map(row => clean(`${row[0]}: ${row[1]}`, 46))].filter(Boolean).slice(0, 4) }
  const head = [kind, clean(block?.l?.day, 10)].filter(Boolean).join(' · ').toUpperCase()
  return { head, lines: title ? [title] : [`#${clean(block?.k, 12)}`, 'words not shown'] }
}
// A fraction "30/36" in a score block's rows, for its bar picture.
export function cardFraction(block) {
  for (const row of Array.isArray(block?.x?.rows) ? block.x.rows : []) { const m = /(\d+)\s*\/\s*(\d+)/.exec(String(row?.[1] ?? '')); if (m && +m[2] > 0) return Math.max(0, Math.min(1, +m[1] / +m[2])) }
  return null
}
const hueOf = block => (parseInt(String(block?.k ?? '0').slice(0, 6), 16) || 0) % 360

function wrap(g, text, width, max) {
  const lines = ['']
  for (const word of String(text).split(' ')) {
    const next = (lines[lines.length - 1] + ' ' + word).trim()
    if (g.measureText(next).width > width && lines[lines.length - 1]) { if (lines.length === max) { lines[max - 1] = lines[max - 1].replace(/.{0,2}$/, '…'); return lines } lines.push(word) } else lines[lines.length - 1] = next
  }
  return lines
}

function picture(g, s, family, block) {
  const u = s / 128, line = 'rgba(190,240,255,0.95)', soft = 'rgba(120,210,240,0.55)'
  g.lineWidth = 4 * u; g.strokeStyle = line; g.fillStyle = soft; g.lineJoin = 'round'
  const box = (x, y, w, h, fill) => { g.beginPath(); g.rect(x * u, y * u, w * u, h * u); if (fill) g.fill(); g.stroke() }
  if (family === 'talk') {
    box(22, 26, 62, 34, true); g.beginPath(); g.moveTo(34 * u, 60 * u); g.lineTo(30 * u, 74 * u); g.lineTo(48 * u, 60 * u); g.stroke()
    box(48, 56, 58, 30, false); g.fillStyle = line; for (const [x, y, w] of [[30, 36, 44], [30, 46, 30], [56, 66, 40], [56, 75, 26]]) g.fillRect(x * u, y * u, w * u, 3 * u)
  } else if (family === 'page') {
    box(34, 20, 60, 76, true); g.fillStyle = line; for (let i = 0; i < 6; i++) g.fillRect(42 * u, (32 + i * 10) * u, (i % 3 === 2 ? 28 : 44) * u, 3 * u)
  } else if (family === 'knight') {
    g.beginPath(); g.moveTo(64 * u, 18 * u); g.lineTo(98 * u, 30 * u); g.lineTo(94 * u, 70 * u); g.lineTo(64 * u, 98 * u); g.lineTo(34 * u, 70 * u); g.lineTo(30 * u, 30 * u); g.closePath(); g.fill(); g.stroke()
    g.beginPath(); g.moveTo(64 * u, 34 * u); g.lineTo(64 * u, 82 * u); g.moveTo(44 * u, 52 * u); g.lineTo(84 * u, 52 * u); g.stroke()
  } else if (family === 'model') {
    box(38, 32, 52, 52, true); box(52, 46, 24, 24, false)
    for (let i = 0; i < 4; i++) { const p = (40 + i * 16) * u; g.beginPath(); g.moveTo(p, 22 * u); g.lineTo(p, 32 * u); g.moveTo(p, 84 * u); g.lineTo(p, 94 * u); g.moveTo(28 * u, p); g.lineTo(38 * u, p); g.moveTo(90 * u, p); g.lineTo(100 * u, p); g.stroke() }
  } else if (family === 'system') {
    const dots = [[36, 36], [92, 30], [64, 62], [34, 90], [94, 86]]
    g.beginPath(); for (const [a, b] of [[0, 2], [1, 2], [3, 2], [4, 2], [0, 1]]) { g.moveTo(dots[a][0] * u, dots[a][1] * u); g.lineTo(dots[b][0] * u, dots[b][1] * u) } g.stroke()
    for (const [x, y] of dots) { g.beginPath(); g.arc(x * u, y * u, 7 * u, 0, 7); g.fillStyle = line; g.fill() }
  } else if (family === 'skill') {
    g.beginPath(); for (let i = 0; i < 16; i++) { const a = i * Math.PI / 8, r = (i % 2 ? 26 : 38) * u; g[i ? 'lineTo' : 'moveTo'](64 * u + Math.cos(a) * r, 58 * u + Math.sin(a) * r) } g.closePath(); g.fill(); g.stroke()
    g.beginPath(); g.arc(64 * u, 58 * u, 10 * u, 0, 7); g.stroke()
  } else if (family === 'folder') {
    g.beginPath(); g.moveTo(24 * u, 34 * u); g.lineTo(52 * u, 34 * u); g.lineTo(60 * u, 44 * u); g.lineTo(104 * u, 44 * u); g.lineTo(104 * u, 90 * u); g.lineTo(24 * u, 90 * u); g.closePath(); g.fill(); g.stroke()
    g.fillStyle = line; for (let i = 0; i < 3; i++) g.fillRect(36 * u, (56 + i * 10) * u, (56 - i * 14) * u, 3 * u)
  } else if (family === 'project') {
    g.beginPath(); g.moveTo(46 * u, 36 * u); g.lineTo(24 * u, 58 * u); g.lineTo(46 * u, 80 * u); g.moveTo(82 * u, 36 * u); g.lineTo(104 * u, 58 * u); g.lineTo(82 * u, 80 * u); g.moveTo(72 * u, 28 * u); g.lineTo(56 * u, 88 * u); g.stroke()
  } else if (family === 'score') {
    const share = cardFraction(block) ?? 0.5
    box(24, 44, 80, 22, false); g.fillStyle = line; g.fillRect(27 * u, 47 * u, 74 * u * share, 16 * u)
    g.font = `bold ${22 * u}px Consolas, monospace`; g.textAlign = 'center'; g.fillText(`${Math.round(share * 100)}%`, 64 * u, 92 * u); g.textAlign = 'left'
  } else {
    // A memory with no kind the page knows: a small constellation, different for every block.
    let seed = parseInt(String(block?.k ?? '1').slice(2, 10), 16) || 1
    const rand = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296 }
    const pts = Array.from({ length: 7 }, () => [24 + rand() * 80, 22 + rand() * 72])
    g.beginPath(); pts.forEach(([x, y], i) => g[i ? 'lineTo' : 'moveTo'](x * u, y * u)); g.stroke()
    for (const [x, y] of pts) { g.beginPath(); g.arc(x * u, y * u, 4.5 * u, 0, 7); g.fillStyle = line; g.fill() }
  }
}

/** Draws one card for a block into a square of side s at (x, y). variant 0: its picture; 1: its words; 2: picture and name. */
export function drawCard(g, x, y, s, block, variant) {
  const u = s / 128, hue = hueOf(block), family = cardFamily(block)
  g.save(); g.translate(x, y); g.beginPath(); g.rect(0, 0, s, s); g.clip()
  g.clearRect(0, 0, s, s)
  const fill = g.createLinearGradient(0, 0, s, s)
  fill.addColorStop(0, `hsla(${190 + (hue % 50)}, 70%, ${variant === 1 ? 10 : 16}%, 0.62)`); fill.addColorStop(1, `hsla(${205 + (hue % 40)}, 80%, 6%, 0.5)`)
  g.fillStyle = fill; g.fillRect(0, 0, s, s)
  g.textBaseline = 'top'
  const text = cardText(block)
  if (variant === 1) {
    g.font = `bold ${14 * u}px Consolas, "Cascadia Mono", monospace`; g.fillStyle = 'rgba(120,215,245,1)'; g.fillText(text.head.slice(0, 30), 8 * u, 7 * u, s - 16 * u)
    g.fillStyle = 'rgba(120,215,245,0.8)'; g.fillRect(8 * u, 25 * u, 44 * u, 2.5 * u)
    g.font = `600 ${text.lines.length > 1 ? 15 * u : 18 * u}px "Segoe UI", system-ui, sans-serif`; g.fillStyle = 'rgba(235,248,252,1)'
    let row = 0
    for (const line of text.lines) for (const part of wrap(g, line, s - 16 * u, text.lines.length > 1 ? 2 : 5)) { if (row < 5) g.fillText(part, 8 * u, (33 + row * 19) * u); row++ }
  } else {
    picture(g, s, family, block)
    g.font = `bold ${(variant === 2 ? 14 : 13) * u}px Consolas, "Cascadia Mono", monospace`; g.fillStyle = 'rgba(160,230,250,0.95)'
    const caption = variant === 2 ? (text.lines[0] || text.head) : text.head
    g.fillText(wrap(g, caption, s - 14 * u, 1)[0], 7 * u, s - 21 * u)
  }
  g.restore()
}

/** One atlas canvas holding every block's cards. Tile t of block i is slot (i * cards + t) % SLOTS. */
export function buildAtlas(blocks) {
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = ATLAS
  const g = canvas.getContext('2d'), cards = cardsPerBlock(blocks.length)
  blocks.forEach((block, i) => {
    if (i * cards >= SLOTS) return   // more blocks than slots: the rest reuse earlier tiles
    for (let t = 0; t < cards; t++) { const slot = i * cards + t; drawCard(g, (slot % GRID) * TILE, Math.floor(slot / GRID) * TILE, TILE, block, t) }
  })
  return { canvas, cards }
}
/** The two large cards of the block the owner has pulled out, side by side on a 2048 x 1024 canvas. */
export const FOCUS = 1024
export function drawFocus(g, block) { drawCard(g, 0, 0, FOCUS, block, 0); drawCard(g, FOCUS, 0, FOCUS, block, 1) }
