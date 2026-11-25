// Nori on the desktop: her form with a box to type in (owner, 2026-11-16: "desktop it should just be the form
// with a box to type what i want"). Click the box to type, click her form to open the app, drag either to move her.
// Her real app keeps running in its hidden window; this page talks to it over a same-origin
// BroadcastChannel and never touches the bridge itself.
import { moodOf } from './mood.js'
import { createCrystalScene } from './crystal-scene.js'
import { mapStamp } from './memory-city.js'

// The bar sits at a fixed place in the window (its centre is the point the window code keeps on a screen).
const DRAG_START = 4
// A single press on her form waits this long, so a double-click (the dive) is not taken as "open the app" first.
const DOUBLE_CLICK_MS = 320
let formClick = 0
const bridge = window.noriFloat ?? { moveBy() {}, ignore() {}, focus() {}, openFull() {} }
// As the desktop this page fills a whole screen: her form in the middle, the type box near the bottom, nothing to drag.
const DESKTOP = new URLSearchParams(location.search).has('desktop')
// On Nori OS she is the real desktop: a solid page with nothing under it, so it is never see-through or click-through.
const OS_DESKTOP = DESKTOP && new URLSearchParams(location.search).has('os')
if (DESKTOP) document.body.classList.add('desktop')
if (OS_DESKTOP) document.body.classList.add('os')
const channel = new BroadcastChannel('nori-orb')
const $ = id => document.getElementById(id)
const dock = $('dock'), box = $('box'), tag = $('tag'), hint = $('hint'), caption = $('caption'), line = $('line'), input = $('input')

let active = false, dragging = null, press = null, ignoring = null
// Her form above the box, on a see-through canvas. If the GPU cannot draw it, the box still works alone.
const form = $('form')
const formRadius = () => (DESKTOP ? Math.min(innerWidth, innerHeight) * 0.3 : 170)
let face = null
try { face = createCrystalScene(form, DESKTOP ? { maxFps: 30, minResolution: 2, transparent: !OS_DESKTOP, onAsk: text => channel.postMessage({ t: 'send', text }), onTalk: () => wake() } : { width: form.clientWidth, height: form.clientHeight, maxFps: 30, transparent: true }) } catch (error) { console.warn('[nori-float] form unavailable', error) }
let lastState = 0, phase = 'offline', spoken = ''
let mood = { rgb: [255, 170, 48], name: 'calm', rage: 0 }
const PHASE_WORDS = { offline: 'offline', boot: 'starting', dormant: '', waking: 'waking', listening: 'listening', thinking: 'thinking', tooling: 'working', speaking: 'speaking' }

function paint() {
  document.documentElement.style.setProperty('--mood', `rgb(${mood.rgb.join(',')})`)
  const word = PHASE_WORDS[phase] ?? ''
  tag.textContent = [word, mood.name === 'calm' && word ? '' : mood.name].filter(Boolean).join(' · ')
  const state = $('t-state'); if (state) state.textContent = ['Nori', tag.textContent].filter(Boolean).join(' · ')
  hint.textContent = active ? 'Enter sends · Esc cancels' : 'click to type'
  document.body.classList.toggle('active', active)
}
// Her reply and the typed line open toward the middle of the screen: above the bar while she is parked in
// the lower half, below it in the upper half, so they stay on the screen wherever the box is dragged.
// The box sits under her form, so her reply always opens below the bar.
function place() { dock.classList.toggle('down', !DESKTOP) }
function setActive(next) {
  if (active === next) return
  active = next
  if (next) { bridge.focus(); input.focus() } else input.blur()
  showLine(); paint()
}
function wake() { if (active) input.focus(); else setActive(true) }
function showLine() {
  const text = input.value
  line.textContent = text
  line.classList.toggle('show', active || text.length > 0)
  line.scrollTop = line.scrollHeight
}
function setCaption(text) {
  const following = caption.scrollHeight - caption.scrollTop - caption.clientHeight < 24
  caption.textContent = text
  caption.classList.toggle('show', Boolean(text))
  if (following) caption.scrollTop = caption.scrollHeight
}

input.addEventListener('input', showLine)
function submit() {
  const text = input.value.trim()
  if (!text) return
  channel.postMessage({ t: 'send', text })
  input.value = ''
  showLine()
}
// The composer buttons (desktop form): each hands its action to the app window, which owns the real controls.
const picker = $('file')
$('t-plus')?.addEventListener('click', () => { bridge.focus(); picker?.click() })
picker?.addEventListener('change', () => {
  const file = picker.files?.[0]
  if (file && file.size <= 12 * 1024 * 1024) channel.postMessage({ t: 'attach', file })
  picker.value = ''
  wake()
})
$('t-zip')?.addEventListener('click', () => channel.postMessage({ t: 'skill-zip' }))
$('t-mic')?.addEventListener('click', () => channel.postMessage({ t: 'mic' }))
$('t-send')?.addEventListener('click', () => { submit(); wake() })
input.addEventListener('keydown', event => {
  if (event.key === 'Escape') { input.value = ''; setActive(false); showLine(); return }
  if (event.key !== 'Enter' || event.shiftKey || event.isComposing) return
  event.preventDefault()
  submit()
})
window.addEventListener('blur', () => { setActive(false); bridge.blurred?.() })

// Inside her (the dive into her memory city) the type box goes away (owner, 2026-11-23: "it still leaves the text
// box on screen"); it comes back when he is out again. Checked often so it follows the dive without a visible lag.
let insideShown = false
function syncInside2() {
  // Only his own dive (double-click) or his moving around in there; her short thinking dives keep the box, since her
  // reply appears in it.
  const inside = Boolean(face?.atCenter?.() || (face?.insideCity?.() && face?.exploring?.()))
  if (inside === insideShown) return
  insideShown = inside
  document.body.classList.toggle('inside', inside)
  if (inside) setActive(false)
}
setInterval(syncInside2, 150)
// A way out (owner, 2026-11-23: "there must be a way for me to exit from inside of her memory"): an Exit button
// that shows while he is inside, and Esc. Esc first lets go of the camera or a block (city-explore.js); pressed
// again, with nothing held, it leaves.
function leaveInside() { if (!face) return; face.setRecall?.(false); setTimeout(syncInside2, 50) }
const exitButton = $('exit')
exitButton?.addEventListener('click', event => { event.stopPropagation(); leaveInside() })
window.addEventListener('keydown', event => {
  if (event.key !== 'Escape' || !face?.insideCity?.()) return
  if (!face.exploring?.()) leaveInside()   // capture phase: read before city-explore lets go on this same press
}, true)
function inBox(event) {
  if (insideShown) return false
  const r = box.getBoundingClientRect()
  return event.clientX >= r.left && event.clientX <= r.right && event.clientY >= r.top && event.clientY <= r.bottom
}
function inForm(event) {
  if (!face) return false
  const r = form.getBoundingClientRect()
  return Math.hypot(event.clientX - (r.left + r.width / 2), event.clientY - (r.top + r.height / 2)) < formRadius()
}
// Only the box and her form take the mouse. Everything else in this window passes clicks to whatever is
// underneath, except while a press that began on them is still held.
function updateClickThrough(event) {
  const ignore = !(press || inBox(event) || inForm(event) || face?.insideCity?.())
  if (ignore === ignoring) return
  ignoring = ignore
  bridge.ignore(ignore)
}
document.addEventListener('pointermove', event => {
  updateClickThrough(event)
  if (!dragging) return
  const dx = event.screenX - dragging.x, dy = event.screenY - dragging.y
  if (!dragging.moved && Math.hypot(event.screenX - dragging.startX, event.screenY - dragging.startY) < DRAG_START) return
  dragging.moved = true
  dragging.x = event.screenX; dragging.y = event.screenY
  if (!DESKTOP) bridge.moveBy(dx, dy)
})
document.addEventListener('pointerdown', event => {
  if (event.button !== 0) return
  if (event.target?.closest?.('#tools, #exit')) return   // a composer button or Exit: its own click handler takes it
  // A press inside her city also gives her window the keyboard, or W A S D would go to whatever had it before.
  if (!inBox(event) && face?.insideCity?.()) bridge.focus()
  const onForm = !inBox(event) && inForm(event) && !face?.insideCity?.()
  if (!inBox(event) && !onForm) { if (!face?.insideCity?.()) setActive(false); return }
  press = { x: event.clientX, y: event.clientY, text: !onForm && caption.contains(event.target), form: onForm }
  // Her reply text keeps the browser's own selecting and scrolling; the rest of the box drags the window.
  if (press.text) return
  dragging = { x: event.screenX, y: event.screenY, startX: event.screenX, startY: event.screenY, moved: false }
  document.documentElement.setPointerCapture?.(event.pointerId)
  event.preventDefault()
})
function release(event) {
  const was = dragging, start = press
  dragging = null; press = null
  if (start?.text) {
    // Selected text stays selected so it can be copied; a plain click on her reply wakes her for typing.
    if (String(getSelection()).length > 0) setActive(false)
    else if (event && Math.hypot(event.clientX - start.x, event.clientY - start.y) < DRAG_START) wake()
  } else if (was?.moved) { place(); if (active) input.focus() }
  // A press on her form opens the app, but only once it is clear the press was not the first half of a
  // double-click (a double-click on her dives into her centre instead).
  else if (start?.form) { if (event) { clearTimeout(formClick); formClick = setTimeout(() => bridge.openFull(), DOUBLE_CLICK_MS) } }
  else if (start && event) wake()
  if (event) updateClickThrough(event)
}
document.addEventListener('pointerup', release)
document.addEventListener('pointercancel', () => release(null))
// A held press is captured by the page root, so its click and double-click arrive there, not on the box:
// decide by where the pointer is. On her reply text a double-click selects a word, as usual.
function onReply(event) {
  if (!caption.classList.contains('show')) return false
  const r = caption.getBoundingClientRect()
  return event.clientY >= r.top && event.clientY <= r.bottom
}
document.addEventListener('dblclick', event => {
  if (inBox(event)) { if (!onReply(event)) bridge.openFull(); return }
  // Double-click on her form (owner, 2026-11-17: "when i double click it should go into her and leave me like in
  // the center of her whole thing"): fly into the middle of her city and stay; double-click again to come out.
  if (inForm(event)) { clearTimeout(formClick); if (face?.diveToCenter?.()) bridge.focus() }
})

channel.onmessage = ({ data }) => {
  if (data?.t !== 'state') return
  lastState = Date.now()
  phase = String(data.phase || 'dormant')
  mood = moodOf(data.affect)
  face?.setPhase(phase); face?.setRage(mood.rage)
  const reply = String(data.caption || '')
  if (reply !== spoken) { spoken = reply; setCaption(reply) }
  // Her state for other displays of her, such as the cooler LCD, which still shows her form.
  bridge.publish?.({ phase, rgb: mood.rgb, name: mood.name, rage: mood.rage, caption: reply.slice(-420) })
  paint()
}
setInterval(() => {
  if (document.hidden) return
  // The heartbeat tells the app window to rest its own face while the small floating one shows. As the desktop she
  // stays on screen with the app open, so the app keeps its face.
  if (!DESKTOP) channel.postMessage({ t: 'float' })
  place()
  if (Date.now() - lastState > 4000 && phase !== 'offline') { phase = 'offline'; face?.setPhase(phase); paint() }
}, 1000)

// Her real memories on the desktop form too (owner, 2026-11-17: "she has to do it from the desktop guy not the
// app"). The same memory map the app window reads (positions and hash prefixes, labels as the app allows) is
// fetched from this page's own local address, so the form dives into her real city while she thinks and flies to
// the memories she recalls. Without the map her face still works and shows the plain interior.
let memoryStamp = '', recallSeen = -1, mapAsked = 0, mapApplied = 0
async function syncMemory() {
  if (!face?.setMemory || document.hidden) return
  const asked = ++mapAsked
  try {
    const response = await fetch('/memory-map', { cache: 'no-store' })
    if (!response.ok) return
    const map = await response.json()
    if (map?.schema !== 'nori.memory-map.v1' || !Array.isArray(map.nodes)) return
    // Replies can overtake each other; an older one must never undo a newer one.
    if (asked < mapApplied) return
    mapApplied = asked
    const stamp = mapStamp(map)
    if (stamp !== memoryStamp) { face.setMemory(map.nodes); memoryStamp = stamp }
    const at = Number(map.recall?.at) || 0
    // The recall already on disk when the page starts is old news; only ones that arrive afterwards play.
    if (recallSeen < 0) recallSeen = at
    else if (at > recallSeen) { recallSeen = at; face.recall?.(map.recall.keys) }
  } catch { /* the map is optional */ }
}
// Her Knights, brains, connected systems, skills, folders and projects become blocks too (desktop/inside-map.cjs).
async function syncInside() {
  if (!face?.setInside) return
  try {
    const response = await fetch('/inside-map', { cache: 'no-store' })
    if (!response.ok) return
    const map = await response.json()
    if (map?.schema === 'nori.inside-map.v1' && Array.isArray(map.groups)) face.setInside(map.groups)
  } catch { /* optional, like the memory map */ }
}
if (DESKTOP) { void syncInside().then(syncMemory); setInterval(syncMemory, 2500); setInterval(syncInside, 15000) }

bridge.ignore(true); ignoring = true
place(); paint(); showLine()
channel.postMessage({ t: 'hello' })
window.noriFloatDebug = { setActive, place, face: () => Boolean(face) }
