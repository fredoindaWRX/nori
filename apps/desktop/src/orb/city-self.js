// A small Nori inside her own city (owner, 2026-11-17: "have a small version of her that appears when i summon her or
// maybe she's working inside of herself"). She goes from block to block as she works: to the memory she is pulling
// while she thinks, to the one she just recalled, otherwise to a block of her own choosing. Press N or click her and
// she comes to the owner and stays beside him as he moves; N again sends her back to work.
import { createFigure } from './figure.js'

const SIZE = 0.2            // her figure is about one unit across; a block is about a fifth of that
const WORK_MS = 4500
/** Which block she works at next: not the one she is at, and not always the same one. random: () => 0..1. */
export function nextWorkBlock(count, current, random = Math.random) {
  if (!(count > 0)) return -1
  if (count === 1) return 0
  const i = Math.min(count - 1, Math.floor(random() * count))
  return i === current ? (i + 1) % count : i
}
/** Where she stands beside the owner: ahead of the camera, to its right and a little low. Plain arrays. */
export function besidePoint(position, forward, right) {
  return [0, 1, 2].map(i => position[i] + forward[i] * 2.3 + right[i] * 0.95 - (i === 1 ? 0.22 : 0))
}

export function createCitySelf({ THREE, additive, scene, container, canvas, camera, getCity, onTalk }) {
  const figure = createFigure(THREE, { additive, density: 0.3 })
  const group = new THREE.Group(); group.add(figure.group); group.scale.setScalar(SIZE); group.visible = false; group.renderOrder = 20
  scene.add(group)
  // The thread from her to the block she is working on.
  const threadGeo = new THREE.BufferGeometry(); threadGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3))
  const threadMat = new THREE.LineBasicMaterial(additive({ color: 0x9fe6ff, transparent: true, opacity: 0 }))
  const thread = new THREE.Line(threadGeo, threadMat); thread.frustumCulled = false; thread.visible = false
  scene.add(thread)

  const pos = new THREE.Vector3(), target = new THREE.Vector3(), dir = new THREE.Vector3(), right = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0), tmp = new THREE.Vector3()
  let mode = 'work', job = -1, nextAt = 0, started = false, busy = false, shown = ''

  const tag = document.createElement('div')
  tag.textContent = 'Nori'
  tag.style.cssText = 'position:absolute;left:0;top:0;display:none;z-index:5;padding:1px 7px;border-radius:999px;pointer-events:none;white-space:nowrap;'
    + 'font:11px/1.4 ui-monospace,Consolas,monospace;color:#e9fbff;background:rgba(2,10,18,0.6);border:1px solid rgba(140,225,255,0.5)'
  const card = document.createElement('div')
  card.setAttribute('role', 'dialog'); card.setAttribute('aria-label', 'Nori, here with you')
  card.style.cssText = 'position:absolute;left:4%;bottom:12%;width:min(340px,40%);display:none;z-index:6;padding:12px 14px;pointer-events:auto;'
    + 'font:13px/1.55 ui-monospace,Consolas,"Cascadia Mono",monospace;color:#bfeeff;background:rgba(2,10,18,0.9);border:1px solid rgba(90,200,255,0.55);border-radius:6px'
  const head = document.createElement('div'); head.textContent = '> Nori · here with you'; head.style.cssText = 'color:#e9fbff;margin-bottom:6px'
  const lines = document.createElement('div')
  const buttons = document.createElement('div')
  const button = (text, action) => {
    const node = document.createElement('button'); node.type = 'button'; node.textContent = text
    node.style.cssText = 'font:inherit;color:#d9f6ff;background:rgba(40,140,200,0.18);border:1px solid rgba(90,200,255,0.55);border-radius:4px;padding:5px 10px;margin:8px 8px 0 0;cursor:pointer'
    node.addEventListener('click', event => { event.stopPropagation(); action() }); return node
  }
  if (typeof onTalk === 'function') buttons.appendChild(button('Talk to her', () => onTalk()))
  buttons.appendChild(button('Back to work', () => dismiss()))
  card.append(head, lines, buttons)
  for (const type of ['pointerdown', 'pointerup', 'wheel', 'dblclick', 'click']) card.addEventListener(type, event => event.stopPropagation())
  container.appendChild(tag); container.appendChild(card)

  const blockName = block => block?.l?.title || (block?.x ? block.x.id : block ? `memory ${block.k}` : 'nothing yet')
  function describe() {
    const city = getCity(), block = city && job >= 0 ? city.plan.blocks[job] : null
    const text = `${busy ? 'thinking' : 'resting'}|${blockName(block)}`
    if (text === shown) return
    shown = text; lines.textContent = ''
    for (const [name, value] of [['state', busy ? 'thinking, pulling what she needs' : 'between tasks'], [busy ? 'pulling' : 'last at', blockName(block)]]) {
      const line = document.createElement('div'), label = document.createElement('span'), body = document.createElement('span')
      label.textContent = name.padEnd(9) + ' '; label.style.cssText = 'color:#5fb6d8;white-space:pre'; body.textContent = value
      line.append(label, body); lines.appendChild(line)
    }
  }
  function call() { mode = 'with'; shown = ''; return true }
  function dismiss() { mode = 'work'; nextAt = 0; card.style.display = 'none' }
  /** She goes to this block now (the memory she is pulling or has just recalled). */
  function goTo(index, now = performance.now()) { const city = getCity(); if (!city || !(index >= 0) || index >= city.plan.blocks.length) return; job = index; nextAt = now + WORK_MS }
  function screenPoint() {
    const r = canvas.getBoundingClientRect()
    camera.getWorldDirection(dir)
    const depth = tmp.copy(group.position).sub(camera.position).dot(dir)
    if (!(depth > 0.2)) return null
    tmp.copy(group.position).project(camera)
    return { x: (tmp.x * 0.5 + 0.5) * r.width, y: (-tmp.y * 0.5 + 0.5) * r.height, depth, reach: Math.max(18, SIZE * 1.1 * (r.height / (2 * Math.tan((camera.fov * Math.PI / 180) / 2))) / depth), left: r.left, top: r.top }
  }
  /** True when a click at these window coordinates lands on her. */
  function hit(clientX, clientY) {
    if (!group.visible) return false
    const p = screenPoint()
    return Boolean(p) && Math.hypot(clientX - p.left - p.x, clientY - p.top - p.y) <= p.reach
  }

  return {
    call, dismiss, goTo, hit,
    toggle() { if (mode === 'with') dismiss(); else call(); return mode === 'with' },
    state: () => ({ mode, job, visible: group.visible, at: [pos.x, pos.y, pos.z] }),
    /** Every frame. t: seconds for her own motion, fire: 0..1 how hard she is working, thinking: she is pulling memories. */
    update(now, dt, t, inside, fire = 0, thinking = false) {
      const city = getCity()
      if (!inside || !city || !city.plan.blocks.length) {
        group.visible = false; thread.visible = false; tag.style.display = 'none'; card.style.display = 'none'; started = false
        if (mode === 'with') mode = 'work'
        return
      }
      busy = thinking
      camera.getWorldDirection(dir); right.crossVectors(dir, up).normalize()
      if (!started) { started = true; job = -1; nextAt = 0; pos.copy(camera.position).addScaledVector(dir, 5).addScaledVector(right, 1.2) }
      if (job >= city.plan.blocks.length) job = -1
      if (mode === 'with') {
        const p = besidePoint(camera.position.toArray(), dir.toArray(), right.toArray()); target.set(p[0], p[1], p[2])
      } else {
        if (job < 0 || now > nextAt) { job = nextWorkBlock(city.plan.blocks.length, job); nextAt = now + WORK_MS + (job % 7) * 400 }
        const p = city.plan.blocks[job].pos; target.set(p[0], p[1] + 0.42, p[2] + 0.3)
      }
      pos.lerp(target, 1 - Math.exp(-dt * (mode === 'with' ? 4.5 : 1.8)))
      group.position.set(pos.x, pos.y + Math.sin(t * 1.3) * 0.03, pos.z)
      group.rotation.y = t * 0.35
      group.visible = true
      figure.update(t, Math.max(fire, thinking ? 0.6 : 0.15), 0, dt)
      // The thread shows only once she has reached the block she is working at.
      const atWork = mode === 'work' && job >= 0 && pos.distanceTo(target) < 0.5
      thread.visible = atWork
      if (atWork) {
        const p = city.plan.blocks[job].pos, a = threadGeo.attributes.position.array
        a[0] = group.position.x; a[1] = group.position.y; a[2] = group.position.z; a[3] = p[0]; a[4] = p[1]; a[5] = p[2]
        threadGeo.attributes.position.needsUpdate = true
        threadMat.opacity = 0.35 + 0.25 * Math.sin(t * 5)
      }
      const s = screenPoint()
      if (s && s.depth < 40) { tag.style.display = 'block'; tag.style.transform = `translate(${Math.round(s.x - 18)}px, ${Math.round(s.y - s.reach - 20)}px)` } else tag.style.display = 'none'
      if (mode === 'with') { describe(); card.style.display = 'block' } else card.style.display = 'none'
    },
    dispose() { scene.remove(group); scene.remove(thread); figure.dispose(); threadGeo.dispose(); threadMat.dispose(); tag.remove(); card.remove() },
  }
}
