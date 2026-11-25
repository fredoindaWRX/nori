import {test} from 'node:test'
import assert from 'node:assert/strict'
import {join} from 'node:path'
import {windowsShortcutPath} from '../scripts/install-desktop-app.mjs'

test('Windows shortcut has one stable Nori name', () => {
  assert.equal(windowsShortcutPath('owner-desktop'), join('owner-desktop', 'Nori.lnk'))
})
