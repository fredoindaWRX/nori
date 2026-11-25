const test = require('node:test'), assert = require('node:assert/strict')
const { mkdtempSync, readFileSync } = require('node:fs'), { tmpdir } = require('node:os'), { join } = require('node:path')
const { createOrbWindow, pickDesktopDisplay } = require('../desktop/orb-window.cjs')

const A = { id: 1, bounds: { x: 0, y: 0, width: 3840, height: 2160 }, workArea: { x: 0, y: 0, width: 3840, height: 2100 } }, B = { id: 2, bounds: { x: 3840, y: 0, width: 1920, height: 1080 }, workArea: { x: 3840, y: 0, width: 1920, height: 1040 } }

test('her desktop takes a screen the owner is not on, and the only screen when there is one', () => {
  assert.equal(pickDesktopDisplay([A, B], 1).id, 2)
  assert.equal(pickDesktopDisplay([A, B], 2).id, 1)
  assert.equal(pickDesktopDisplay([A], 1).id, 1)
  assert.equal(pickDesktopDisplay([], 1), null)
  const C = { id: 3, bounds: { x: -1920, y: 0, width: 1920, height: 1080 } }
  assert.equal(pickDesktopDisplay([A, B, C], 1, 3).id, 3, 'stays where she is when that screen is still free')
})

function harness({ displays = [A, B], cursor = { x: 100, y: 100 }, state, platform = 'win32' } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'nori-orb-')), stateFile = join(dir, 'orb-window.json')
  if (state) require('node:fs').writeFileSync(stateFile, JSON.stringify(state))
  const made = [], handlers = {}
  class FakeWindow {
    constructor(options) { this.options = options; this.bounds = { x: options.x, y: options.y, width: options.width, height: options.height }; this.focused = false; this.visible = false; this.focusable = options.focusable !== false; this.destroyed = false
      this.webContents = { setWindowOpenHandler() {}, on() {}, once: (_e, fn) => { this.loaded = fn }, isLoading: () => false }; made.push(this) }
    on() {} once() {} setIgnoreMouseEvents(v) { this.ignore = v; this.ignoreCalls = (this.ignoreCalls ?? 0) + 1 } setAlwaysOnTop(v) { this.top = v } loadURL(url) { this.url = url; return Promise.resolve() }
    showInactive() { this.visible = true } show() { this.visible = true } hide() { this.visible = false } focus() { this.focused = true }
    isDestroyed() { return this.destroyed } isVisible() { return this.visible } isFocused() { return this.focused } isLoading() { return false }
    setFocusable(v) { this.focusable = v } setBounds(b) { this.bounds = b } getPosition() { return [this.bounds.x, this.bounds.y] } setPosition() {} destroy() { this.destroyed = true }
  }
  const env = { cursor }
  const screen = { getAllDisplays: () => displays, getPrimaryDisplay: () => displays[0], getCursorScreenPoint: () => env.cursor,
    getDisplayNearestPoint: p => displays.find(d => p.x >= d.bounds.x && p.x < d.bounds.x + d.bounds.width) ?? displays[0] }
  const orb = createOrbWindow({ BrowserWindow: FakeWindow, ipcMain: { on: (name, fn) => { handlers[name] = fn } }, screen, url: 'http://127.0.0.1:1/orb.html', origin: 'http://127.0.0.1:1', preload: 'p', stateFile, onOpenFull() {}, platform })
  return { orb, made, handlers, env, stateFile }
}

test('as the desktop she takes 75% of the other screen, centred, is not on top, and takes focus only while the owner types', () => {
  const { orb, made, handlers } = harness()
  assert.equal(orb.isDesktop(), true)
  orb.show()
  const win = made[0]
  // 75% of B's work area (1920x1040), centred (owner, 2026-11-21).
  assert.deepEqual(win.bounds, { x: 4080, y: 130, width: 1440, height: 780 })
  assert.equal(win.options.alwaysOnTop, false); assert.equal(win.options.focusable, false); assert.equal(win.options.transparent, true)
  assert.equal(win.url, 'http://127.0.0.1:1/orb.html?desktop=1')
  assert.equal(win.ignore, true, 'see-through and click-through until the pointer is on her form or box (2026-11-21: not boxed in)')
  const event = { sender: win.webContents }
  handlers['nori:orb:focus'](event); assert.equal(win.focusable, true); assert.equal(win.focused, true)
  handlers['nori:orb:blur'](event); assert.equal(win.focusable, false)
  handlers['nori:orb:move'](event, 50, 50); assert.deepEqual(win.bounds, { x: 4080, y: 130, width: 1440, height: 780 }) // dragging does not move the desktop
})

test('the tray choice switches to the small floating window and is remembered', () => {
  const { orb, made, stateFile } = harness()
  orb.show()
  assert.equal(orb.setDesktop(false), false)
  assert.equal(made[0].destroyed, true)
  assert.equal(made[1].options.alwaysOnTop, true); assert.equal(made[1].options.width, 560); assert.equal(made[1].url, 'http://127.0.0.1:1/orb.html')
  assert.equal(JSON.parse(readFileSync(stateFile, 'utf8')).desktop, false)
  assert.equal(harness({ state: { desktop: false } }).orb.isDesktop(), false)
})

test('on Nori OS (Linux) she is the real desktop: whole screen, solid, under other windows, and she keeps the mouse', () => {
  const { orb, made, handlers, env } = harness({ platform: 'linux' })
  orb.show()
  const win = made[0]
  // The whole primary screen, not 75% of the free one: there is no other desktop to show round her.
  assert.deepEqual(win.bounds, { x: 0, y: 0, width: 3840, height: 2160 })
  assert.equal(win.options.type, 'desktop'); assert.equal(win.options.transparent, false); assert.equal(win.options.backgroundColor, '#000000')
  assert.equal(win.options.alwaysOnTop, false)
  assert.notEqual(win.options.focusable, false, 'a non-focusable window on Linux floats over everything')
  assert.equal(win.url, 'http://127.0.0.1:1/orb.html?desktop=1&os=1')
  // Linux cannot forward mouse moves through a click-through window, so she must never become one.
  assert.equal(win.ignoreCalls ?? 0, 0)
  const event = { sender: win.webContents }
  handlers['nori:orb:ignore'](event, true); assert.equal(win.ignoreCalls ?? 0, 0)
  handlers['nori:orb:focus'](event); assert.equal(win.focused, true)
  handlers['nori:orb:blur'](event); assert.equal(win.focusable, true)
  // The floating form on Linux is also never click-through.
  assert.equal(orb.setDesktop(false), false)
  assert.equal(made[1].options.alwaysOnTop, true); assert.equal(made[1].ignoreCalls ?? 0, 0); assert.equal(made[1].url, 'http://127.0.0.1:1/orb.html')
  void env
})
