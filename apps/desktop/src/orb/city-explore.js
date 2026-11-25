// Walking around inside her and opening what is in the blocks (owner, 2026-11-17: "i should be able to maneuver
// thru inside and find everything about her in there and pull up a window ... pop up a terminal or options to
// access whatever information lies inside the box", then "i should also be able to summon the block and they come
// out of where they are at").
//
// While the view is inside her memory city:
//   - W A S D / arrow keys move, Space or E up, Q or C down, Shift faster, the wheel moves forward and back, and a
//     drag looks around. The first key or wheel turn takes the camera over from the tour; Esc gives it back.
//   - a click on a block SUMMONS it: the block leaves its place, flies to just in front of the camera and a
//     terminal-style window opens with what the page knows about that memory. Esc, "Send it back" or a click on
//     another block returns it to its place.
//   - "Find" in the window searches the memory titles and summons a result from wherever it is.
//
// What the window can show is what the memory map carries: kind, day and the first words (title), never the full
// memory text, and nothing at all while labels are withheld (OBS running). "Ask Nori about this" sends her a normal
// chat message, so the full content comes from her own recall, with her own rules.
// Pure helpers (nearestOnScreen, findMemories, askText) are exported for tests; they touch no DOM.

const KEYS = { KeyW: 'f', ArrowUp: 'f', KeyS: 'b', ArrowDown: 'b', KeyA: 'l', ArrowLeft: 'l', KeyD: 'r', ArrowRight: 'r', Space: 'u', KeyE: 'u', KeyQ: 'd', KeyC: 'd', KeyZ: 'rl', KeyX: 'rr' }
// Swimming (owner, 2026-11-23: "like you're swimming ... do backflips in one spot ... what is up is not really down"):
// there is no fixed up in here. His view is a free orientation: a drag turns it about its own axes with no limit, so he
// can loop right over; Z and X roll; every move key works relative to the view (forward, across, and its own up).
const TURN = 0.004, ROLL = 1.5, DRIFT = 0.45, DRIFT_REST = 4.5
const SPEED = 3.2, FAST = 3, SUMMON_MS = 650, HOLD_DISTANCE = 1.7, PICK_PX = 46, LIMIT = 70

/** Index of the candidate nearest the pointer in screen pixels, or -1. points: [{ x, y, depth, reach }] (reach: its radius in px). */
export function nearestOnScreen(points, px, py, slack = PICK_PX) {
  let best = -1, score = Infinity
  for (let i = 0; i < points.length; i++) {
    const p = points[i]
    if (!p || !(p.depth > 0)) continue
    const d = Math.hypot(p.x - px, p.y - py)
    if (d > Math.max(slack, p.reach || 0)) continue
    // Prefer what is under the pointer; among those, what is closer to the camera.
    const s = d + p.depth * 4
    if (s < score) { score = s; best = i }
  }
  return best
}

/** Blocks whose label matches every word typed, best first. blocks: [{ k, l: { kind, day, title } }]. */
export function findMemories(blocks, query, limit = 8) {
  const words = String(query ?? '').toLowerCase().split(/\s+/).filter(Boolean).slice(0, 6)
  if (!words.length) return []
  const out = []
  blocks.forEach((block, index) => {
    const text = `${block?.l?.title ?? ''} ${block?.l?.kind ?? ''} ${block?.l?.day ?? ''} ${block?.k ?? ''}`.toLowerCase()
    if (!words.every(word => text.includes(word))) return
    const title = String(block?.l?.title ?? '').toLowerCase()
    out.push({ index, score: words.reduce((n, word) => n + (title.startsWith(word) ? 3 : title.includes(word) ? 2 : 1), 0) })
  })
  return out.sort((a, b) => b.score - a.score || a.index - b.index).slice(0, limit).map(hit => hit.index)
}

/** The chat message "Ask Nori about this" sends, or '' when the block has no words to ask with. */
export function askText(block) {
  // A file or system block brings its own question.
  if (block?.x) return String(block.x.ask ?? '').replace(/\s+/g, ' ').trim().slice(0, 200)
  const title = String(block?.l?.title ?? '').replace(/\s+/g, ' ').trim().slice(0, 80)
  if (!title) return ''
  const day = /^\d{4}-\d{2}-\d{2}$/.test(String(block?.l?.day ?? '')) ? ` from ${block.l.day}` : ''
  return `Tell me what you remember about this${day}: "${title}"`
}

const typingTarget = target => Boolean(target?.closest?.('input, textarea, select, [contenteditable=""], [contenteditable="true"]'))

export function createCityExplore({ THREE, container, canvas, camera, camPos, getCity, isInside, onAsk, onTaken = () => {}, onCall, pickFirst }) {
  const held = new Set()
  const orient = new THREE.Quaternion(), turn = new THREE.Quaternion(), AX = new THREE.Vector3(1, 0, 0), AY = new THREE.Vector3(0, 1, 0), AZ = new THREE.Vector3(0, 0, 1)
  let free = false, look = false, lastX = 0, lastY = 0, press = null, wheel = 0
  let summoned = null   // { index, t0, from: [x,y,z], home: [x,y,z], returning }
  const dir = new THREE.Vector3(), right = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0), tmp = new THREE.Vector3(), matrix = new THREE.Matrix4()

  // ---- the window ----
  const panel = document.createElement('div')
  panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-label', 'Memory block')
  panel.style.cssText = 'position:absolute;right:4%;top:14%;width:min(420px,44%);max-height:64%;overflow:auto;display:none;z-index:6;padding:14px 16px;'
    + 'font:13px/1.55 ui-monospace,Consolas,"Cascadia Mono",monospace;color:#bfeeff;background:rgba(2,10,18,0.9);border:1px solid rgba(90,200,255,0.55);'
    + 'box-shadow:0 0 0 1px rgba(0,0,0,0.6),0 0 24px rgba(40,160,255,0.25);border-radius:6px;pointer-events:auto;user-select:text'
  const hint = document.createElement('div')
  hint.style.cssText = 'position:absolute;left:50%;top:18px;transform:translateX(-50%);display:none;z-index:6;padding:5px 12px;border-radius:999px;'
    + 'font:12px/1.4 ui-monospace,Consolas,monospace;color:#9fdcf2;background:rgba(2,10,18,0.72);border:1px solid rgba(90,200,255,0.3);pointer-events:none;white-space:nowrap'
  hint.textContent = 'W A S D swim · Space / Q up, down · Z X roll · Shift fast · drag to turn · let go to drift to her brain · click a block · Esc lets go, again exits'
  container.appendChild(panel); container.appendChild(hint)
  const el = (tag, text, css) => { const node = document.createElement(tag); if (text !== undefined) node.textContent = text; if (css) node.style.cssText = css; return node }
  const button = (text, action) => {
    const node = el('button', text, 'font:inherit;color:#d9f6ff;background:rgba(40,140,200,0.18);border:1px solid rgba(90,200,255,0.55);border-radius:4px;padding:5px 10px;margin:8px 8px 0 0;cursor:pointer')
    node.type = 'button'; node.addEventListener('click', event => { event.stopPropagation(); action() }); return node
  }
  function row(name, value) {
    const line = el('div'); line.appendChild(el('span', `${name.padEnd(9)} `, 'color:#5fb6d8;white-space:pre')); line.appendChild(el('span', value)); return line
  }
  function showPanel(index) {
    const city = getCity(); if (!city) return
    const block = city.plan.blocks[index], labelled = Boolean(block.l?.title)
    panel.textContent = ''
    if (block.x) {
      // A Knight, brain, connected system, skill, folder or project: its own few facts, no memory fields.
      panel.appendChild(el('div', `> ${block.l?.kind || 'item'} · ${block.x.group}`, 'color:#e9fbff;margin-bottom:6px'))
      panel.appendChild(el('div', block.l?.title || block.x.id, 'color:#e9fbff;margin:2px 0 6px;font-size:14px'))
      for (const [name, value] of block.x.rows) panel.appendChild(row(name, value))
    } else {
    panel.appendChild(el('div', `> memory ${block.k}`, 'color:#e9fbff;margin-bottom:6px'))
    panel.appendChild(row('kind', block.l?.kind || 'unknown'))
    panel.appendChild(row('day', block.l?.day || 'unknown'))
    panel.appendChild(row('district', `${(block.sector ?? 0) + 1} of ${city.plan.sectors.length}`))
    panel.appendChild(row('block', `${index + 1} of ${city.plan.blocks.length}`))
    panel.appendChild(el('div', labelled ? `"${block.l.title}"` : 'Its words are not shown right now (they are withheld while OBS is running, or this memory has no saved title).',
      `margin:8px 0 2px;color:${labelled ? '#e9fbff' : '#8fb4c4'}`))
    }
    if (labelled) {
      // Other memories filed beside it, by title, so the owner can step through a district.
      const near = city.plan.blocks.map((other, i) => ({ i, other })).filter(({ i, other }) => i !== index && other.sector === block.sector && other.l?.title)
        .map(({ i, other }) => ({ i, d: Math.hypot(other.pos[0] - block.pos[0], other.pos[1] - block.pos[1], other.pos[2] - block.pos[2]), title: other.l.title }))
        .sort((a, b) => a.d - b.d).slice(0, 4)
      if (near.length) {
        panel.appendChild(el('div', 'beside it', 'color:#5fb6d8;margin-top:8px'))
        for (const item of near) { const link = el('div', `· ${item.title}`, 'cursor:pointer;color:#a9e3f7'); link.addEventListener('click', event => { event.stopPropagation(); summon(item.i) }); panel.appendChild(link) }
      }
    }
    const ask = askText(block)
    if (ask && typeof onAsk === 'function') panel.appendChild(button('Ask Nori about this', () => { onAsk(ask); release() }))
    panel.appendChild(button('Send it back', release))
    // Find: type words from a memory's title, pick one, and it comes out of wherever it is.
    const find = el('input', undefined, 'display:block;width:100%;box-sizing:border-box;margin-top:12px;padding:6px 8px;font:inherit;color:#e9fbff;background:rgba(0,0,0,0.45);border:1px solid rgba(90,200,255,0.4);border-radius:4px;outline:none')
    find.type = 'search'; find.placeholder = 'find a memory, file, skill or system…'; find.setAttribute('aria-label', 'Find inside her')
    const results = el('div')
    find.addEventListener('input', () => {
      results.textContent = ''
      for (const i of findMemories(city.plan.blocks, find.value)) {
        const b = city.plan.blocks[i], hit = el('div', `→ ${b.l?.title || b.k}${b.l?.day ? `  (${b.l.day})` : ''}`, 'cursor:pointer;color:#a9e3f7;margin-top:3px')
        hit.addEventListener('click', event => { event.stopPropagation(); summon(i) }); results.appendChild(hit)
      }
      if (find.value.trim() && !results.childNodes.length) results.appendChild(el('div', 'nothing by those words', 'color:#8fb4c4;margin-top:3px'))
    })
    // Typing here must not move the camera, but Esc still sends the block back.
    find.addEventListener('keydown', event => { event.stopPropagation(); if (event.code === 'Escape') { event.preventDefault(); release() } })
    panel.appendChild(find); panel.appendChild(results)
    panel.style.display = 'block'
  }
  for (const type of ['pointerdown', 'pointerup', 'wheel', 'dblclick', 'click']) panel.addEventListener(type, event => event.stopPropagation())

  // ---- summoning ----
  const placeCube = (city, index, p) => { city.cubes.setMatrixAt(index, matrix.makeTranslation(p[0], p[1], p[2])); city.cubes.instanceMatrix.needsUpdate = true }
  const holdPoint = () => { camera.getWorldDirection(dir); tmp.copy(camera.position).addScaledVector(dir, HOLD_DISTANCE); return [tmp.x - 0.42, tmp.y - 0.05, tmp.z] }
  function sendHome(now = performance.now()) {
    if (!summoned || summoned.returning) return
    summoned = { ...summoned, returning: true, t0: now, from: summoned.at ?? summoned.from }
  }
  function summon(index) {
    const city = getCity(); if (!city || !(index >= 0) || index >= city.plan.blocks.length) return false
    const now = performance.now()
    if (summoned && summoned.index !== index) { placeCube(city, summoned.index, summoned.home); if (summoned.lit) city.lit[summoned.index] = 0 }
    const home = city.plan.blocks[index].pos.slice(0, 3)
    const lit = !(city.lit[index] >= 1)
    city.lit[index] = 1; city.detail.setLit(city.lit)
    summoned = { index, t0: now, from: summoned?.index === index && summoned.at ? summoned.at : home, home, returning: false, lit, at: null }
    city.detail.setFocus?.(index)
    showPanel(index)
    return true
  }
  function release() { panel.style.display = 'none'; sendHome() }
  function stepSummon(now) {
    const city = getCity()
    if (!summoned) return
    if (!city || summoned.index >= city.plan.blocks.length) { summoned = null; panel.style.display = 'none'; return }
    const t = Math.min(1, (now - summoned.t0) / SUMMON_MS), k = 1 - Math.pow(1 - t, 3)
    const to = summoned.returning ? summoned.home : holdPoint()
    const at = [0, 1, 2].map(i => summoned.from[i] + (to[i] - summoned.from[i]) * k)
    placeCube(city, summoned.index, at)
    if (summoned.returning) {
      if (t >= 1) { if (summoned.lit) { city.lit[summoned.index] = 0; city.detail.setLit(city.lit) } city.detail.setFocus?.(-1); summoned = null }
    } else {
      summoned.at = at
      // Once it has arrived it stays in front of the camera as the owner moves.
      if (t >= 1) { summoned.from = at; summoned.t0 = now - SUMMON_MS }
    }
  }

  // ---- moving and looking ----
  function take() {
    if (free) return
    orient.copy(camera.quaternion).normalize()
    free = true; onTaken(true)
  }
  function letGo() { if (!free) return; free = false; held.clear(); wheel = 0; onTaken(false) }
  function pick(event) {
    const city = getCity(); if (!city) return -1
    const r = canvas.getBoundingClientRect(), px = event.clientX - r.left, py = event.clientY - r.top
    camera.updateMatrixWorld(); camera.getWorldDirection(dir)
    const scale = r.height / (2 * Math.tan((camera.fov * Math.PI / 180) / 2))
    const points = city.plan.blocks.map(block => {
      tmp.set(block.pos[0], block.pos[1], block.pos[2])
      const depth = tmp.clone().sub(camera.position).dot(dir)
      if (!(depth > 0.3) || depth > 60) return null
      tmp.project(camera)
      return { x: (tmp.x * 0.5 + 0.5) * r.width, y: (-tmp.y * 0.5 + 0.5) * r.height, depth, reach: 0.22 * scale / depth }
    })
    return nearestOnScreen(points, px, py)
  }
  const onKeyDown = event => {
    if (!isInside() || !getCity() || typingTarget(event.target) || event.ctrlKey || event.altKey || event.metaKey) return
    if (event.code === 'Escape') { if (summoned && !summoned.returning) { release(); event.preventDefault() } else if (free) { letGo(); event.preventDefault() } return }
    if (event.code === 'ShiftLeft' || event.code === 'ShiftRight') { held.add('shift'); return }
    if (event.code === 'KeyN' && typeof onCall === 'function') { if (!event.repeat) onCall(); event.preventDefault(); return }
    const move = KEYS[event.code]
    if (!move) return
    held.add(move); take(); event.preventDefault()
  }
  const onKeyUp = event => { if (event.code === 'ShiftLeft' || event.code === 'ShiftRight') held.delete('shift'); const move = KEYS[event.code]; if (move) held.delete(move) }
  const onDown = event => {
    if (event.button !== 0 || !isInside() || !getCity()) return
    press = { x: event.clientX, y: event.clientY, moved: false }; look = true; lastX = event.clientX; lastY = event.clientY
  }
  const onMove = event => {
    if (!look) return
    const dx = event.clientX - lastX, dy = event.clientY - lastY; lastX = event.clientX; lastY = event.clientY
    if (press && Math.hypot(event.clientX - press.x, event.clientY - press.y) > 5) press.moved = true
    if (press?.moved && !free && isInside() && getCity()) take()
    if (free && press?.moved) { orient.multiply(turn.setFromAxisAngle(AY, -dx * TURN)).multiply(turn.setFromAxisAngle(AX, -dy * TURN)).normalize() }
  }
  const onUp = event => {
    const was = press; press = null; look = false
    if (!was || was.moved || !isInside() || !getCity() || event.target !== canvas) return
    if (typeof pickFirst === 'function' && pickFirst(event)) return
    const index = pick(event)
    if (index >= 0) summon(index); else if (summoned && !summoned.returning) release()
  }
  const onWheel = event => { if (!isInside() || !getCity()) return; wheel += Math.max(-3, Math.min(3, -event.deltaY / 120)); take(); event.preventDefault() }
  const onBlur = () => held.clear()
  addEventListener('keydown', onKeyDown); addEventListener('keyup', onKeyUp); addEventListener('blur', onBlur)
  canvas.addEventListener('pointerdown', onDown); addEventListener('pointermove', onMove); addEventListener('pointerup', onUp)
  canvas.addEventListener('wheel', onWheel, { passive: false })

  return {
    /** True while the owner has the camera. */
    active: () => free,
    summoned: () => (summoned && !summoned.returning ? summoned.index : -1),
    summon, release, letGo,
    /** The block a click at these window coordinates would summon, or -1. */
    pickAt: (clientX, clientY) => pick({ clientX, clientY }),
    /** Move the camera for this frame. Call only while active() and inside the city. */
    fly(dt) {
      const roll = (held.has('rl') ? 1 : 0) - (held.has('rr') ? 1 : 0)
      if (roll) orient.multiply(turn.setFromAxisAngle(AZ, roll * ROLL * dt)).normalize()
      dir.set(0, 0, -1).applyQuaternion(orient); right.set(1, 0, 0).applyQuaternion(orient); up.set(0, 1, 0).applyQuaternion(orient)
      const speed = SPEED * (held.has('shift') ? FAST : 1) * dt
      const forward = (held.has('f') ? 1 : 0) - (held.has('b') ? 1 : 0) + wheel * 2.2
      wheel *= Math.max(0, 1 - dt * 9)
      camPos.addScaledVector(dir, forward * speed).addScaledVector(right, ((held.has('r') ? 1 : 0) - (held.has('l') ? 1 : 0)) * speed)
      camPos.addScaledVector(up, ((held.has('u') ? 1 : 0) - (held.has('d') ? 1 : 0)) * speed)
      // With nothing held he drifts slowly toward her brain, as if it had a faint pull (owner, 2026-11-23: "you just
      // kind of fall to wherever is in the center of it"), and comes to rest a little way off it.
      const centre = getCity()?.plan?.centre
      if (centre && Math.abs(forward) < 0.02 && !['l', 'r', 'u', 'd'].some(key => held.has(key))) {
        tmp.set(centre[0] - camPos.x, centre[1] - camPos.y, centre[2] - camPos.z)
        const away = tmp.length()
        if (away > DRIFT_REST) camPos.addScaledVector(tmp, Math.min(away - DRIFT_REST, DRIFT * dt) / away)
      }
      const m = camPos.length(); if (m > LIMIT) camPos.multiplyScalar(LIMIT / m)
      camera.position.copy(camPos); camera.up.copy(up); camera.quaternion.copy(orient)
      const city = getCity(); if (city) city.look.set(camPos.x + dir.x * 10, camPos.y + dir.y * 10, camPos.z + dir.z * 10)
    },
    /** Every frame: the hint, the summoned block, and cleaning up when the view leaves the city. */
    update(now, inside) {
      const here = inside && Boolean(getCity())
      // The desktop page keeps her form click-through (#form has pointer-events: none), so the canvas never saw a
      // press there: inside the city it must take the mouse itself.
      const want = here ? 'auto' : ''
      if (canvas.style.pointerEvents !== want) canvas.style.pointerEvents = want
      hint.style.display = here ? 'block' : 'none'
      if (!here) { if (free) letGo(); if (summoned) { const city = getCity(); if (city && summoned.index < city.plan.blocks.length) { placeCube(city, summoned.index, summoned.home); if (summoned.lit) { city.lit[summoned.index] = 0; city.detail.setLit(city.lit) } } summoned = null; panel.style.display = 'none' } return }
      stepSummon(now)
    },
    setShift(on) { if (on) held.add('shift'); else held.delete('shift') },
    dispose() {
      removeEventListener('keydown', onKeyDown); removeEventListener('keyup', onKeyUp); removeEventListener('blur', onBlur)
      canvas.removeEventListener('pointerdown', onDown); removeEventListener('pointermove', onMove); removeEventListener('pointerup', onUp)
      canvas.removeEventListener('wheel', onWheel)
      panel.remove(); hint.remove()
    },
  }
}
