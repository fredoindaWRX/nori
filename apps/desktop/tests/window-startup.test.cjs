const test = require('node:test')
const assert = require('node:assert/strict')
const { EventEmitter } = require('node:events')
const { bindWindowStartup } = require('../desktop/window-startup.cjs')

function fixture(probe = false) {
  const window = new EventEmitter(), events = []
  window.webContents = new EventEmitter()
  window.isDestroyed = () => false
  window.setIcon = icon => events.push(`icon:${icon}`)
  bindWindowStartup(window, { probe, currentIcon: () => 'nori',
    arrangeWorkspace: () => events.push('arrange'), showNori: () => events.push('show') })
  return { window, events }
}

test('normal first load arranges and shows without needing ready-to-show', () => {
  const f = fixture()
  f.window.webContents.emit('did-finish-load')
  assert.deepEqual(f.events, ['icon:nori', 'arrange', 'show'])
})
test('ready-to-show then load initializes exactly once', () => {
  const f = fixture()
  f.window.emit('ready-to-show')
  f.window.webContents.emit('did-finish-load')
  assert.deepEqual(f.events, ['icon:nori', 'arrange', 'show'])
})
test('late ready-to-show cannot reset layout or re-show a user-hidden window', () => {
  const f = fixture()
  f.window.webContents.emit('did-finish-load')
  f.events.push('user-hide')
  f.window.emit('ready-to-show')
  f.window.webContents.emit('did-finish-load')
  assert.deepEqual(f.events, ['icon:nori', 'arrange', 'show', 'user-hide'])
})
test('hidden acceptance probe initializes bounds but neither event reveals it', () => {
  for (const first of ['load', 'ready']) {
    const f = fixture(true)
    if (first === 'load') f.window.webContents.emit('did-finish-load')
    f.window.emit('ready-to-show')
    f.window.webContents.emit('did-finish-load')
    assert.deepEqual(f.events, ['icon:nori', 'arrange'])
  }
})
test('events delivered after window destruction do not touch the native handle', () => {
  const f = fixture()
  f.window.isDestroyed = () => true
  f.window.emit('ready-to-show')
  f.window.webContents.emit('did-finish-load')
  assert.deepEqual(f.events, [])
})
