'use strict'
const { mkdirSync, readFileSync, renameSync, writeFileSync } = require('node:fs')
const { dirname, join } = require('node:path')

// Nori's face outside the app window. Two forms:
//   - desktop (owner, 2026-11-16: "nori needs to be the desktop", "Only Nori, no Windows desktop"): one window that
//     fills a whole screen with her form and a type box. It is not kept on top, so the owner's own windows open over
//     her, and it moves to the other screen when he works on the one she is on.
//   - floating: the earlier small transparent always-on-top window (tray menu switches back).
// It is only a face; her real app keeps running in its main window. A failure here must never take the app down.
const WIDTH = 560, HEIGHT = 790
// She leaves a screen after the pointer has stayed on it this long without her being the focused window.
const CROWDED_MS = 45_000, WATCH_MS = 5_000

/** The screen for her desktop: one the owner is not on when there is a choice, else the only screen. */
function pickDesktopDisplay(displays, cursorDisplayId, currentId = null) {
  if (!Array.isArray(displays) || !displays.length) return null
  const free = displays.filter(display => display.id !== cursorDisplayId)
  if (!free.length) return displays[0]
  return free.find(display => display.id === currentId) ?? free[0]
}

// Her desktop covers 75% of the screen's work area, centred (owner, 2026-11-21: "doesn't have to fill all of it, like
// 75 percent of the desktop"), so the real desktop shows round her.
const DESKTOP_SHARE = 0.75
function desktopBounds(display) {
  const a = display.workArea ?? display.bounds
  const width = Math.round(a.width * DESKTOP_SHARE), height = Math.round(a.height * DESKTOP_SHARE)
  return { x: Math.round(a.x + (a.width - width) / 2), y: Math.round(a.y + (a.height - height) / 2), width, height }
}

// On Nori OS (Linux) she is the real desktop (owner, 2026-11-12: "just the orb in desktop, taskbar on top"): there is
// no other desktop to show round her or to pass clicks to, so she fills the whole screen and takes the mouse herself.
const isOsDesktop = platform => platform === 'linux'
function osDesktopBounds(display) {
  const b = display.bounds ?? display.workArea
  return { x: b.x, y: b.y, width: b.width, height: b.height }
}

function clampToDisplays(position, displays) {
  if (!position || !Number.isFinite(position.x) || !Number.isFinite(position.y) || !displays.length) return null
  const centre = { x: position.x + WIDTH / 2, y: position.y + 280 }
  const hit = displays.find(({ workArea: a }) => centre.x >= a.x && centre.x < a.x + a.width && centre.y >= a.y && centre.y < a.y + a.height)
  return hit ? { x: Math.round(position.x), y: Math.round(position.y) } : null
}
function defaultPosition(primary) {
  const a = primary.workArea
  return { x: Math.round(a.x + a.width - WIDTH + 40), y: Math.round(a.y + a.height - HEIGHT + 20) }
}

function createOrbWindow({ BrowserWindow, ipcMain, screen, url, origin, preload, stateFile, icon, onOpenFull, log = () => {}, platform = process.platform }) {
  let win = null, saveTimer = null, wanted = false, latest = null, displayId = null, crowded = 0, watcher = null
  const readPosition = () => { try { return JSON.parse(readFileSync(stateFile, 'utf8')) } catch { return null } }
  // Desktop form is the default; the owner's tray choice is kept in the same small state file.
  let desktop = readPosition()?.desktop !== false
  // True while she is the Nori OS desktop: a whole screen, solid, under every other window, never click-through.
  const osDesktop = () => desktop && isOsDesktop(platform)
  const writeState = patch => {
    try {
      mkdirSync(dirname(stateFile), { recursive: true })
      writeFileSync(`${stateFile}.tmp`, JSON.stringify({ ...(readPosition() ?? {}), ...patch }), 'utf8')
      renameSync(`${stateFile}.tmp`, stateFile)
    } catch (error) { log(`Could not save the orb state: ${error.code || 'unknown'}`) }
  }
  const save = () => {
    clearTimeout(saveTimer)
    saveTimer = setTimeout(() => {
      if (!win || win.isDestroyed()) return
      if (desktop) return
      const [x, y] = win.getPosition()
      writeState({ x, y })
    }, 400)
  }
  const owns = event => win && !win.isDestroyed() && event.sender === win.webContents
  ipcMain.on('nori:orb:move', (event, dx, dy) => {
    if (desktop || !owns(event) || !Number.isFinite(dx) || !Number.isFinite(dy) || Math.abs(dx) > 4000 || Math.abs(dy) > 4000) return
    const [x, y] = win.getPosition()
    win.setPosition(Math.round(x + dx), Math.round(y + dy))
    save()
  })
  ipcMain.on('nori:orb:ignore', (event, value) => {
    // Linux has no forwarded mouse moves, so a click-through window there could never be reached again.
    if (owns(event) && !isOsDesktop(platform)) win.setIgnoreMouseEvents(value === true, value === true ? { forward: true } : undefined)
  })
  // Her current state for other displays of her, such as the cooler LCD page. Plain bounded values only.
  ipcMain.on('nori:orb:state', (event, state) => {
    if (!owns(event) || !state || typeof state !== 'object') return
    const rgb = Array.isArray(state.rgb) && state.rgb.length === 3 && state.rgb.every(n => Number.isFinite(n) && n >= 0 && n <= 255) ? state.rgb.map(Math.round) : [255, 170, 48]
    latest = { phase: String(state.phase ?? '').slice(0, 20), name: String(state.name ?? '').slice(0, 20), rgb, caption: String(state.caption ?? '').slice(0, 420), rage: Number.isFinite(state.rage) ? Math.max(0, Math.min(1, state.rage)) : 0, at: Date.now() }
  })
  // As the desktop she never takes focus by herself; she takes it only while the owner types to her.
  ipcMain.on('nori:orb:focus', event => { if (owns(event)) { if (desktop && !osDesktop()) win.setFocusable(true); win.show(); win.focus() } })
  ipcMain.on('nori:orb:blur', event => { if (owns(event) && desktop && !osDesktop()) win.setFocusable(false) })
  ipcMain.on('nori:orb:open-full', event => { if (owns(event)) onOpenFull() })

  const cursorDisplay = () => screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
  // Stay off the screen the owner is working on: when the pointer has been on her screen for a while and she is not
  // the focused window, she moves to another screen if there is one. With one screen she simply stays underneath.
  function watchDesktop() {
    if (!desktop || osDesktop() || !win || win.isDestroyed() || !win.isVisible()) return
    const displays = screen.getAllDisplays()
    const mine = displays.find(display => display.id === displayId)
    const here = cursorDisplay()
    crowded = mine && here.id === displayId && !win.isFocused() ? crowded + WATCH_MS : 0
    if (mine && crowded < CROWDED_MS) return
    const target = pickDesktopDisplay(displays, here.id, mine ? null : displayId)
    crowded = 0
    if (!target || target.id === displayId) return
    displayId = target.id
    placeOn(target)
    log(`Nori's desktop moved to the screen the owner is not using`)
  }
  // Electron sizes a window wrongly when it lands on a screen with a different scale (measured 2026-11-21: 75% of the
  // 150% Samsung came out 1280x696 across both monitors). Setting the bounds again once it is there fixes it.
  function placeOn(display) {
    if (!win || win.isDestroyed() || !display) return
    const bounds = osDesktop() ? osDesktopBounds(display) : desktopBounds(display)
    win.setBounds(bounds); win.setBounds(bounds)
  }
  function create() {
    const webPreferences = { contextIsolation: true, sandbox: true, nodeIntegration: false, webSecurity: true, spellcheck: false, preload }
    if (osDesktop()) {
      // Window type "desktop" keeps her under every app window and the top panel. A non-focusable window on Linux
      // stops talking to the window manager and floats over everything, so here she stays focusable.
      const target = screen.getPrimaryDisplay() ?? screen.getAllDisplays()[0]
      displayId = target.id; crowded = 0
      win = new BrowserWindow({
        ...osDesktopBounds(target), type: 'desktop', title: 'Nori', icon, show: false, frame: false, transparent: false, backgroundColor: '#000000',
        hasShadow: false, resizable: false, movable: false, maximizable: false, minimizable: false, fullscreenable: false,
        skipTaskbar: true, alwaysOnTop: false, autoHideMenuBar: true, webPreferences,
      })
      placeOn(target)
      win.once('show', () => { const now = screen.getAllDisplays().find(d => d.id === displayId); if (now) placeOn(now) })
    } else if (desktop) {
      const target = pickDesktopDisplay(screen.getAllDisplays(), cursorDisplay().id) ?? screen.getPrimaryDisplay()
      displayId = target.id; crowded = 0
      win = new BrowserWindow({
        // See-through (owner, 2026-11-21: "don't make it boxed in"): only her form and the box show; the empty
        // parts let clicks through to the real desktop (float.js asks for that through nori:orb:ignore).
        ...desktopBounds(target), title: 'Nori', icon, show: false, frame: false, transparent: true, backgroundColor: '#00000000',
        hasShadow: false, thickFrame: false, resizable: false, movable: false, maximizable: false, minimizable: false, fullscreenable: false,
        skipTaskbar: true, alwaysOnTop: false, focusable: false, autoHideMenuBar: true, webPreferences,
      })
      placeOn(target)
      win.once('show', () => { const now = screen.getAllDisplays().find(d => d.id === displayId); if (now) placeOn(now) })
      watcher ??= setInterval(() => { try { watchDesktop() } catch (error) { log(`Desktop watch failed: ${error?.message}`) } }, WATCH_MS)
      watcher.unref?.()
    } else {
    const place = clampToDisplays(readPosition(), screen.getAllDisplays()) ?? defaultPosition(screen.getPrimaryDisplay())
    win = new BrowserWindow({
      ...place, width: WIDTH, height: HEIGHT, title: 'Nori', icon, show: false, frame: false, transparent: true,
      backgroundColor: '#00000000', hasShadow: false, thickFrame: false, resizable: false, maximizable: false, minimizable: false,
      fullscreenable: false, skipTaskbar: true, alwaysOnTop: true, autoHideMenuBar: true,
      webPreferences,
    })
    }
    const floating = !desktop
    const pageUrl = osDesktop() ? `${url}?desktop=1&os=1` : desktop ? `${url}?desktop=1` : url
    // Electron's 'floating' level left this window non-topmost on the owner's PC (measured 2026-11-10, no WS_EX_TOPMOST),
    // so her box sat behind other windows. Pin it at a level above the taskbar and pin it again whenever it is shown.
    const pin = () => { if (floating && win && !win.isDestroyed()) { win.setAlwaysOnTop(false); win.setAlwaysOnTop(true, 'screen-saver') } }
    pin()
    win.on('show', pin)
    if (!isOsDesktop(platform)) win.setIgnoreMouseEvents(true, { forward: true })
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    win.webContents.on('will-navigate', (event, target) => { if (new URL(target).origin !== origin) event.preventDefault() })
    win.webContents.on('render-process-gone', () => {
      log('Floating orb renderer stopped; reloading it')
      setTimeout(() => { if (win && !win.isDestroyed()) void win.loadURL(pageUrl).catch(() => {}) }, 2000)
    })
    win.on('closed', () => { win = null })
    win.webContents.once('did-finish-load', () => { if (wanted && win && !win.isDestroyed()) win.showInactive() })
    void win.loadURL(pageUrl).catch(() => log('Floating orb page failed to load'))
  }
  return {
    show() {
      wanted = true
      if (!win) create()
      else if (!win.webContents.isLoading()) win.showInactive()
    },
    hide() { wanted = false; if (win && !win.isDestroyed()) win.hide() },
    // Loads her page without showing the window, so it can keep publishing her state while the bar is off.
    prepare() { if (!win) create() },
    isVisible: () => Boolean(win && !win.isDestroyed() && win.isVisible()),
    isDesktop: () => desktop,
    // Switch between being the desktop and the small floating window; the choice is remembered.
    setDesktop(next) {
      next = next === true
      if (next === desktop) return desktop
      desktop = next; writeState({ desktop })
      const old = win; win = null
      if (old && !old.isDestroyed()) old.destroy()
      if (wanted) create()
      return desktop
    },
    state: () => latest,
  }
}
module.exports = { createOrbWindow, clampToDisplays, defaultPosition, pickDesktopDisplay, desktopBounds, osDesktopBounds, isOsDesktop, WIDTH, HEIGHT }
