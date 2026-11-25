// The owner's panel for tuning Nori's face (vision doc part 5). Plain DOM, built here because the face
// bundle owns it; it only reads and writes the face settings and never talks to the network.
import { FACE_DEFAULTS, RESOLUTIONS, faceSettings } from './crystal-scene.js'

// One row per dial: what the owner sees, the range, and what it does.
export const DIALS = Object.freeze([
  { key: 'brightness', label: 'Brightness', min: 0.3, max: 1.6, step: 0.05, hint: 'How bright she is overall.' },
  { key: 'hue', label: 'Colour', min: -180, max: 180, step: 1, unit: '°', hint: 'Turns her away from blue. 0 is her own blue.' },
  { key: 'saturation', label: 'Colour strength', min: 0, max: 2, step: 0.05, hint: '0 is white light, 1 is normal, 2 is vivid.' },
  { key: 'bloom', label: 'Glow', min: 0, max: 1.2, step: 0.02, hint: 'How much light spills around her.' },
  { key: 'fireRate', label: 'Firing speed', min: 0.2, max: 3, step: 0.05, hint: 'How fast the pulses and shimmer run.' },
  { key: 'diveSpeed', label: 'Dive speed', min: 0.05, max: 0.8, step: 0.01, hint: 'How fast she flies through her memory.' },
  { key: 'autoDive', label: 'Dive when she recalls', min: 0, max: 1, step: 1, toggle: true, hint: 'When a message brings memories back, fly into her and out again. Off: the memories just light up.' },
  { key: 'labels', label: 'Labels on memories', min: 0, max: 1, step: 1, toggle: true, hint: 'Show what each memory is when you fly close. Off hides every sign, recalled ones too. The words are always hidden while OBS is running.' },
  { key: 'resolution', label: 'Resolution', min: 0, max: RESOLUTIONS.length - 1, step: 1, choices: RESOLUTIONS.map(r => r[0]), hint: 'How many pixels she is drawn with before being shown at window size: 2K, 4K or 8K. Higher is finer and costs more GPU; 8K is heavy.' },
  { key: 'density', label: 'Detail', min: 0.2, max: 2, step: 0.05, hint: 'How many points and ribbons. Higher costs more GPU; her face reloads to apply it.' },
])
export const formatDial = (value, unit) => (unit ? Math.round(Number(value)) + unit : (Math.round(Number(value) * 100) / 100).toFixed(2))
// One-click colours: degrees to turn her blue to reach each one.
export const COLOURS = Object.freeze([['Blue', 0], ['Teal', -30], ['Green', -90], ['Violet', 50], ['Red', 150], ['Gold', -165]])

const CSS = `
#nori-face-panel{position:fixed;right:18px;bottom:18px;z-index:2147483000;width:292px;padding:14px 14px 12px;border-radius:12px;
  background:rgba(8,16,30,.92);border:1px solid rgba(110,170,240,.28);box-shadow:0 12px 40px rgba(0,0,0,.55);
  color:#dfeeff;font:12px/1.35 Inter,"Segoe UI",system-ui,sans-serif;backdrop-filter:blur(8px)}
#nori-face-panel h2{margin:0 0 2px;font-size:13px;font-weight:600;letter-spacing:.02em}
#nori-face-panel .nfp-sub{margin:0 0 10px;color:#8fb0d8;font-size:11px}
#nori-face-panel .nfp-row{margin:0 0 9px}
#nori-face-panel .nfp-top{display:flex;justify-content:space-between;align-items:baseline}
#nori-face-panel .nfp-top output{color:#9fc6f5;font-variant-numeric:tabular-nums}
#nori-face-panel input[type=range]{width:100%;margin:3px 0 0;accent-color:#5bb8ff}
#nori-face-panel input[type=checkbox]{margin:4px 0 0;width:16px;height:16px;accent-color:#5bb8ff}
#nori-face-panel .nfp-hint{color:#7f9dc2;font-size:10.5px}
#nori-face-panel .nfp-buttons{display:flex;gap:6px;flex-wrap:wrap;margin-top:10px}
#nori-face-panel .nfp-colours{margin-top:5px;gap:4px}
#nori-face-panel .nfp-colours button{padding:3px 7px;font-size:11px}
#nori-face-panel .nfp-choices{margin:4px 0 2px;gap:4px}
#nori-face-panel .nfp-choices button{flex:1;padding:4px 0}
#nori-face-panel{max-height:calc(100vh - 36px);overflow:auto}
#nori-face-panel button{font:inherit;color:#dfeeff;background:rgba(60,140,235,.18);border:1px solid rgba(110,170,240,.35);
  border-radius:8px;padding:5px 9px;cursor:pointer}
#nori-face-panel button:hover{background:rgba(60,140,235,.32)}
#nori-face-panel button:focus-visible,#nori-face-panel input:focus-visible{outline:2px solid #8fd0ff;outline-offset:2px}
#nori-face-panel button[aria-pressed=true]{background:rgba(60,140,235,.5)}
#nori-face-panel .nfp-close{position:absolute;top:8px;right:8px;padding:2px 8px}
#nori-face-panel .nfp-off{color:#f0c27a;margin:0 0 8px}
.nori-face-open{font:inherit;cursor:pointer}
`

// host: { settings(), setSettings(next), face(), setFace(name), restart(), toggleRecall(), recalling() }
export function createFacePanel(host) {
  let panel = null, restartTimer = 0, opener = null
  const inputs = new Map(), choices = new Map()

  function refresh() {
    if (!panel) return
    const crystal = host.face() === 'crystal', values = host.settings() || faceSettings()
    for (const [key, { input, output }] of inputs) {
      if (input.type === 'checkbox') { input.checked = values[key] >= 0.5; output.textContent = input.checked ? 'On' : 'Off' }
      else { input.value = values[key]; output.textContent = formatDial(values[key], input.dataset.unit) }
      input.disabled = !crystal
    }
    for (const [key, { buttons, output, names }] of choices) {
      buttons.forEach((button, i) => { button.setAttribute('aria-pressed', String(i === values[key])); button.disabled = !crystal })
      // If the GPU could not hold the chosen size, say which one is really in use.
      const used = key === 'resolution' ? host.resolutionInUse?.() ?? -1 : -1
      output.textContent = (names[values[key]] || names[0]) + (used >= 0 && used < values[key] ? ' (using ' + names[used] + ')' : '')
    }
    const known = host.memoryCount()
    panel.querySelector('.nfp-mem').textContent = known ? known + ' of her real memories are on the sphere.' : 'Her memories have not loaded onto the sphere yet.'
    panel.querySelector('.nfp-off').hidden = crystal
    for (const button of panel.querySelectorAll('[data-face]')) button.setAttribute('aria-pressed', String(button.dataset.face === host.face()))
    panel.querySelector('[data-dive]').disabled = !crystal
    for (const pick of panel.querySelectorAll('[data-colour]')) { pick.disabled = !crystal; pick.setAttribute('aria-pressed', String(Number(pick.dataset.degrees) === values.hue)) }
  }
  function change(key, value) {
    const next = host.setSettings({ [key]: Number(value) }) || faceSettings({ ...host.settings(), [key]: Number(value) })
    if (choices.has(key)) { refresh(); return }
    const row = inputs.get(key)
    row.output.textContent = row.input.type === 'checkbox' ? (next[key] >= 0.5 ? 'On' : 'Off') : formatDial(next[key], row.input.dataset.unit)
    // Detail changes how much geometry exists, so her face is rebuilt once the slider settles.
    if (key === 'density') { clearTimeout(restartTimer); restartTimer = setTimeout(() => host.restart(), 600) }
  }
  function build() {
    if (!document.getElementById('nori-face-panel-style')) {
      const style = document.createElement('style'); style.id = 'nori-face-panel-style'; style.textContent = CSS; document.head.appendChild(style)
    }
    panel = document.createElement('section'); panel.id = 'nori-face-panel'
    panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-label', 'Face settings')
    const el = (tag, props = {}, text) => { const node = Object.assign(document.createElement(tag), props); if (text !== undefined) node.textContent = text; return node }
    panel.append(el('h2', {}, 'Her face'), el('p', { className: 'nfp-sub' }, 'Changes apply as you drag and are remembered.'),
      el('p', { className: 'nfp-off', hidden: true }, 'These dials tune the crystal face. Switch to it below to use them.'),
      el('p', { className: 'nfp-sub nfp-mem' }, ''))
    const close = el('button', { className: 'nfp-close', type: 'button', title: 'Close (Esc)' }, '×'); close.setAttribute('aria-label', 'Close face settings')
    close.onclick = () => api.close(); panel.append(close)
    for (const dial of DIALS) {
      const id = 'nfp-' + dial.key, row = el('div', { className: 'nfp-row' }), top = el('div', { className: 'nfp-top' })
      const output = el('output', { htmlFor: id })
      if (dial.choices) {
        // A row of buttons instead of a slider: one per choice, applied at once.
        const group = el('div', { className: 'nfp-buttons nfp-choices', id }); group.setAttribute('role', 'group'); group.setAttribute('aria-label', dial.label)
        const buttons = dial.choices.map((name, i) => { const b = el('button', { type: 'button' }, name); b.dataset.choice = dial.key + ':' + i; b.onclick = () => change(dial.key, i); group.append(b); return b })
        top.append(el('span', {}, dial.label), output)
        row.append(top, group, el('div', { className: 'nfp-hint' }, dial.hint))
        panel.append(row); choices.set(dial.key, { buttons, output, names: dial.choices }); continue
      }
      top.append(el('label', { htmlFor: id }, dial.label), output)
      const input = dial.toggle ? el('input', { id, type: 'checkbox' }) : el('input', { id, type: 'range', min: dial.min, max: dial.max, step: dial.step })
      if (dial.unit) input.dataset.unit = dial.unit
      input.oninput = () => change(dial.key, dial.toggle ? (input.checked ? 1 : 0) : input.value)
      row.append(top, input, el('div', { className: 'nfp-hint' }, dial.hint))
      if (dial.key === 'hue') {
        const swatches = el('div', { className: 'nfp-buttons nfp-colours' })
        for (const [name, degrees] of COLOURS) {
          const pick = el('button', { type: 'button' }, name); pick.dataset.colour = name; pick.dataset.degrees = degrees
          pick.onclick = () => { change('hue', degrees); refresh() }
          swatches.append(pick)
        }
        row.append(swatches)
      }
      panel.append(row); inputs.set(dial.key, { input, output })
    }
    const buttons = el('div', { className: 'nfp-buttons' })
    const dive = el('button', { type: 'button' }, 'Dive in / out'); dive.dataset.dive = '1'; dive.onclick = () => host.toggleRecall()
    const reset = el('button', { type: 'button' }, 'Reset'); reset.onclick = () => { host.setSettings({ ...FACE_DEFAULTS }); host.restart(); refresh() }
    const crystal = el('button', { type: 'button' }, 'Crystal'); crystal.dataset.face = 'crystal'
    const lattice = el('button', { type: 'button' }, 'Earlier orb'); lattice.dataset.face = 'lattice'
    for (const button of [crystal, lattice]) button.onclick = () => { host.setFace(button.dataset.face); refresh() }
    buttons.append(dive, reset, crystal, lattice); panel.append(buttons)
    panel.addEventListener('keydown', e => { if (e.key === 'Escape') { e.stopPropagation(); api.close() } })
    document.body.appendChild(panel)
  }
  // Adds an "Open face settings" button to her own Settings card when that card is on screen. The page may
  // redraw the card and drop the button, so this is safe to call again and again.
  function attach() {
    const card = document.querySelector('.settings')
    if (!card || card.querySelector('.nori-face-open')) return false
    const button = document.createElement('button')
    button.type = 'button'; button.className = 'nori-face-open'; button.textContent = 'Face settings…'
    button.onclick = () => api.open()
    card.appendChild(button)
    return true
  }
  const api = {
    open() { if (!panel || panel.hidden) opener = document.activeElement; if (!panel) build(); panel.hidden = false; refresh(); (panel.querySelector('input:not([disabled])') || panel.querySelector('button'))?.focus() },
    // Focus goes back to whatever opened the panel, not to the page body.
    close() { if (!panel || panel.hidden) return; const inside = panel.contains(document.activeElement); panel.hidden = true; if (inside && opener?.isConnected) opener.focus?.(); opener = null },
    toggle() { if (panel && !panel.hidden) api.close(); else api.open(); return api.isOpen() },
    isOpen: () => Boolean(panel && !panel.hidden),
    refresh, attach,
  }
  return api
}
