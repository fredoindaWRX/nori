import { createOrbScene } from './orb-scene.js'
import { createCrystalScene, faceSettings, loadFaceSettings, saveFaceSettings } from './crystal-scene.js'
import { createFacePanel } from './face-panel.js'
import { mapStamp } from './memory-city.js'

const STORAGE_KEY = 'nori.presence'
// Which face the full window shows: 'crystal' (owner vision 2026-11-14, default) or 'lattice' (the earlier orb).
const FACE_KEY = 'nori.face'
function faceName() { try { return localStorage.getItem(FACE_KEY) === 'lattice' ? 'lattice' : 'crystal' } catch { return 'crystal' } }
// HUD status label -> phase. UY in the renderer bundle: OFFLINE INITIALISING STANDBY ONLINE
// LISTENING PROCESSING "ACCESSING SYSTEMS" RESPONDING.
const LABEL_PHASE = {
  OFFLINE: 'offline', INITIALISING: 'boot', STANDBY: 'dormant', ONLINE: 'waking',
  LISTENING: 'listening', PROCESSING: 'thinking', 'ACCESSING SYSTEMS': 'tooling', RESPONDING: 'speaking',
}
// ——— Mount into Nori's page ———
let api = null, host = null, floatSeen = 0
function wanted() { try { return (localStorage.getItem(STORAGE_KEY) || 'orb') !== 'brain' } catch { return true } }
function remember(mode) { try { localStorage.setItem(STORAGE_KEY, mode) } catch {} }
function currentPhase() {
  const label = document.querySelector('.status-text')?.textContent?.trim().toUpperCase() || ''
  return LABEL_PHASE[label] || null
}
function show() {
  if (api) return
  host = document.createElement('div'); host.id = 'nori-orb'; host.setAttribute('aria-hidden', 'true')
  document.body.prepend(host)
  document.body.classList.add('nori-orb-on')
  api = { setPhase() {}, dispose() {}, pause() {}, resume() {}, resetView() {} } // placeholder until the frame below
  requestAnimationFrame(() => {
    if (!host) return
    try { api = faceName() === 'lattice' ? createOrbScene(host) : createCrystalScene(host, { onAsk: text => sendMessage(String(text).slice(0, 400)) }) }
    catch (error) {
      // If the new face cannot start on this machine, fall back to the earlier one rather than leaving her faceless.
      console.warn('[nori-orb] face could not start', error)
      try { host.replaceChildren(); api = createOrbScene(host) } catch (again) { console.warn('[nori-orb] could not start', again); hide(); return }
    }
    api.setPhase(currentPhase() || 'dormant')
  })
}
function hide() {
  document.body.classList.remove('nori-orb-on')
  api?.dispose(); api = null; host?.remove(); host = null; memoryStamp = ''
}
function setFace(name) { if (name === 'lattice' || name === 'crystal') { try { localStorage.setItem(FACE_KEY, name) } catch {} if (api) { hide(); show() } } return faceName() }
const storedFaceSettings = loadFaceSettings
// Owner's face panel: Ctrl+Shift+F, the button it adds to her Settings card, or window.noriOrb.panel().
const panel = createFacePanel({
  settings: () => api?.settings?.() || storedFaceSettings(),
  // With the earlier orb showing there is no live face to tell, so the choice is saved for the next start.
  setSettings: next => { if (api?.setSettings) return api.setSettings(next); const all = faceSettings({ ...storedFaceSettings(), ...next }); saveFaceSettings(all); return all },
  face: faceName, setFace,
  restart: () => { if (api) { hide(); show() } },
  toggleRecall: () => api?.toggleRecall?.(),
  memoryCount: () => api?.memoryCount?.() || 0,
  resolutionInUse: () => api?.resolutionInUse?.() ?? -1,
})
// Her real memory map comes from the app on this same local page origin (positions and hash prefixes only).
let memoryStamp = '', recallSeen = -1, mapAsked = 0, mapApplied = 0
async function syncMemory() {
  if (!api?.setMemory) { memoryStamp = ''; return }
  const asked = ++mapAsked
  try {
    const response = await fetch('/memory-map', { cache: 'no-store' })
    if (!response.ok) return
    const map = await response.json()
    if (map?.schema !== 'nori.memory-map.v1' || !Array.isArray(map.nodes)) return
    // Replies can overtake each other; an older one must never undo a newer one (labels hidden for OBS).
    if (asked < mapApplied) return
    mapApplied = asked
    const stamp = mapStamp(map)
    if (stamp !== memoryStamp && api?.setMemory) { api.setMemory(map.nodes); memoryStamp = stamp; panel.refresh() }
    const at = Number(map.recall?.at) || 0
    // The recall already on disk when the page starts is old news; only ones that arrive afterwards play.
    if (recallSeen < 0) recallSeen = at
    else if (at > recallSeen) { recallSeen = at; api?.recall?.(map.recall.keys) }
  } catch { /* the map is optional; her face works without it */ }
}
// Her Knights, brains, connected systems, skills, folders and projects become blocks too (desktop/inside-map.cjs).
async function syncInside() {
  if (!api?.setInside) return
  try {
    const response = await fetch('/inside-map', { cache: 'no-store' })
    if (!response.ok) return
    const map = await response.json()
    if (map?.schema === 'nori.inside-map.v1' && Array.isArray(map.groups)) api.setInside(map.groups)
  } catch { /* optional, like the memory map */ }
}
function toggle() { if (api) { hide(); remember('brain') } else { show(); remember('orb') } return Boolean(api) }
// The Earth surface (Cesium) replaces the whole stage; stand aside while it is open.
const floating = () => Date.now() - floatSeen < 2600
function syncVisibility() {
  panel.attach()
  if (!api || !host) return
  const earth = Boolean(document.querySelector('.earth-surface'))
  host.style.display = earth ? 'none' : ''
  if (earth || floating()) api.pause(); else api.resume()
  const phase = currentPhase(); if (phase) api.setPhase(phase)
}
function start() {
  if (wanted()) show()
  startFloatLink()
  new MutationObserver(syncVisibility).observe(document.body, { childList: true, subtree: true, characterData: true })
  addEventListener('keydown', e => { if (e.ctrlKey && e.shiftKey && (e.key === 'O' || e.key === 'o')) { e.preventDefault(); toggle() } })
  // Recall dive: Ctrl+Shift+M, or a 'nori-recall' event with detail true/false from the app.
  addEventListener('keydown', e => { if (e.ctrlKey && e.shiftKey && (e.key === 'M' || e.key === 'm')) { e.preventDefault(); api?.toggleRecall?.() } })
  addEventListener('nori-recall', e => api?.setRecall?.(e.detail !== false))
  addEventListener('keydown', e => { if (e.ctrlKey && e.shiftKey && (e.key === 'F' || e.key === 'f')) { e.preventDefault(); panel.toggle() } })
  // Escape closes the face panel from anywhere, not only while focus is inside it.
  addEventListener('keydown', e => { if (e.key === 'Escape' && panel.isOpen()) panel.close() })
  window.noriOrb = { show: () => { show(); remember('orb') }, hide: () => { hide(); remember('brain') }, toggle, active: () => Boolean(api), resetView: () => api?.resetView(),
    recall: on => (on === undefined ? api?.toggleRecall?.() : api?.setRecall?.(Boolean(on))),
    settings: next => (next ? api?.setSettings?.(next) : api?.settings?.()), resolutionInUse: () => api?.resolutionInUse?.() ?? -1,
    memory: () => api?.memoryCount?.() || 0, lit: () => api?.litCount?.() || 0, city: () => api?.city?.() || null, face: setFace, panel: open => (open === undefined ? panel.toggle() : open ? panel.open() : panel.close()) }
}
if (document.body) start(); else addEventListener('DOMContentLoaded', start, { once: true })

// The floating orb window lives in a separate page: feed it her state and hand its typed messages to the real chat box.
function lastReply() {
  const lines = document.querySelectorAll('.log-nori')
  const node = lines[lines.length - 1]
  if (!node) return ''
  const copy = node.cloneNode(true)
  copy.querySelectorAll('.log-who, button').forEach(part => part.remove())
  return copy.textContent.replace(/\s+/g, ' ').trim().slice(-8000)
}
function sendMessage(text, tries = 0) {
  const box = document.querySelector('.textbar-input')
  const ready = document.querySelector('.workspace-send[type="submit"]')
  if (!box || !ready) { if (tries < 150) setTimeout(() => sendMessage(text, tries + 1), 200); return }
  Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(box, text)
  box.dispatchEvent(new Event('input', { bubbles: true }))
  setTimeout(() => box.form?.requestSubmit(), 60)
}
// A file chosen on the desktop form goes into the app's own attachment input, the way a pasted screenshot does.
function attachFile(file, tries = 0) {
  const input = document.querySelector('form.textbar input[type="file"]')
  if (!input) { if (tries < 50) setTimeout(() => attachFile(file, tries + 1), 200); return }
  try { const transfer = new DataTransfer(); transfer.items.add(file); input.files = transfer.files; input.dispatchEvent(new Event('change', { bubbles: true })) } catch (error) { console.warn('[nori-orb] attachment not passed on', error) }
}
function startFloatLink() {
  const channel = new BroadcastChannel('nori-orb')
  let sent = ''
  const publish = force => {
    const state = { t: 'state', phase: currentPhase() || 'dormant', affect: window.__noriAffect || null, caption: lastReply() }
    const text = JSON.stringify(state)
    if (force || text !== sent) { sent = text; channel.postMessage(state) }
  }
  channel.onmessage = ({ data }) => {
    if (data?.t === 'float') { const was = floating(); floatSeen = Date.now(); if (!was) syncVisibility() }
    else if (data?.t === 'hello') publish(true)
    else if (data?.t === 'send' && typeof data.text === 'string' && data.text.trim()) sendMessage(data.text.slice(0, 20000))
    // Composer buttons on the desktop form: press the app's own controls for it.
    else if (data?.t === 'attach' && data.file instanceof File && data.file.size <= 12 * 1024 * 1024) attachFile(data.file)
    else if (data?.t === 'skill-zip') void window.noriSkills?.openInstaller?.()
    else if (data?.t === 'mic') document.querySelector('form.textbar > button.textbar-attach[aria-label*="voice" i]')?.click()
  }
  setInterval(() => publish(false), 250)
  setInterval(syncMemory, 2000)
  void syncInside(); setInterval(syncInside, 15000)
  setInterval(() => publish(true), 2000)
  setInterval(() => { if (api && !floating()) syncVisibility() }, 1500)
}
