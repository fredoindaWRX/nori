import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const root = fileURLToPath(new URL('..', import.meta.url))
const read = (...parts) => readFileSync(join(root, ...parts), 'utf8')
const require = createRequire(import.meta.url)
const { shouldAnimateIconFrames } = require('../desktop/icon-policy.cjs')

test('native and standard desktop packages include the static Nori taskbar icon', () => {
  const native = read('electron-builder.native.yml')
  const standard = read('electron-builder.suite.yml')
  assert.match(native, /public\/nori-icon\.ico/)
  assert.match(standard, /public\/nori-icon\.ico/)
  assert.ok(existsSync(join(root, 'public', 'nori-icon.ico')))
})

test('a packaged static ICO prevents legacy animated globe frames from overriding it', () => {
  const main = read('desktop', 'main.cjs')
  assert.match(main, /shouldAnimateIconFrames\(ICON\)/)
  assert.equal(shouldAnimateIconFrames('public/nori-icon.ico', () => true), false)
  assert.equal(shouldAnimateIconFrames('public/nori-icon.png', () => true), true)
  assert.equal(shouldAnimateIconFrames('public/nori-icon.ico', () => false), true)
})
