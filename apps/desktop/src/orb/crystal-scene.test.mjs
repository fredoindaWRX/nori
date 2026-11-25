import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { faceSettings, FACE_DEFAULTS, PHASE_FIRE } from './crystal-scene.js'
test('face settings fall back to defaults and clamp bad values', () => {
  assert.deepEqual(faceSettings(), { ...FACE_DEFAULTS })
  assert.deepEqual(faceSettings('junk'), { ...FACE_DEFAULTS })
  const s = faceSettings({ bloom: 99, density: -5, fireRate: 'x', diveSpeed: 0.5, brightness: null, extra: 1 })
  assert.equal(s.bloom, 1.2); assert.equal(s.density, 0.2); assert.equal(s.fireRate, FACE_DEFAULTS.fireRate)
  assert.equal(s.diveSpeed, 0.5); assert.equal(s.brightness, 0.3); assert.equal('extra' in s, false)
})
test('every HUD phase the page reports has a fire level between 0 and 1', () => {
  for (const phase of ['offline', 'boot', 'dormant', 'waking', 'listening', 'thinking', 'tooling', 'speaking']) {
    assert.ok(PHASE_FIRE[phase] >= 0 && PHASE_FIRE[phase] <= 1, phase)
  }
})
test('the page entry uses the crystal face by default and keeps the lattice as fallback', () => {
  const entry = readFileSync(new URL('./nori-orb.js', import.meta.url), 'utf8')
  assert.match(entry, /faceName\(\) === 'lattice' \? createOrbScene\(host\) : createCrystalScene\(host, \{ onAsk: /)
  assert.match(entry, /api = createOrbScene\(host\) \} catch \(again\)/)
})
import { DIALS, formatDial } from './face-panel.js'
test('every face dial has a panel slider inside the limits the scene accepts', () => {
  assert.deepEqual(DIALS.map(d => d.key).sort(), Object.keys(FACE_DEFAULTS).sort())
  for (const d of DIALS) {
    assert.equal(faceSettings({ [d.key]: d.min })[d.key], d.min, d.key + ' min')
    assert.equal(faceSettings({ [d.key]: d.max })[d.key], d.max, d.key + ' max')
    assert.ok(FACE_DEFAULTS[d.key] >= d.min && FACE_DEFAULTS[d.key] <= d.max, d.key + ' default in range')
    assert.ok(d.label && d.hint)
  }
  assert.equal(formatDial(0.4200001), '0.42')
})
import { COLOURS } from './face-panel.js'
test('colour settings default to her own blue and clamp', () => {
  assert.equal(FACE_DEFAULTS.hue, 0); assert.equal(FACE_DEFAULTS.saturation, 1)
  assert.equal(faceSettings({ hue: 999 }).hue, 180); assert.equal(faceSettings({ saturation: -1 }).saturation, 0)
  assert.equal(formatDial(150, '°'), '150°')
  assert.equal(COLOURS[0][1], 0)
  for (const [name, degrees] of COLOURS) assert.equal(faceSettings({ hue: degrees }).hue, degrees, name)
})
import { RESOLUTIONS, internalSize, migrateSettings } from './crystal-scene.js'
test('resolution is 2K, 4K or 8K only, keeps the window shape and stays inside the GPU limit', () => {
  assert.equal(FACE_DEFAULTS.resolution, 0)
  assert.deepEqual(RESOLUTIONS.map(r => r[0]), ['2K', '4K', '8K'])
  assert.equal(faceSettings({ resolution: 9 }).resolution, 2); assert.equal(faceSettings({ resolution: -2 }).resolution, 0)
  assert.equal(faceSettings({ resolution: 0.6 }).resolution, 1); assert.equal(faceSettings({ resolution: 'x' }).resolution, 0)
  assert.deepEqual(internalSize(0, 1920, 1080), { w: 2560, h: 1440 })
  assert.deepEqual(internalSize(1, 1920, 1080), { w: 3840, h: 2160 })
  assert.deepEqual(internalSize(2, 1920, 1080), { w: 7680, h: 4320 })
  // A tall window gets the same number of pixels in its own shape.
  const tall = internalSize(1, 800, 1600)
  assert.ok(Math.abs(tall.w * tall.h - 3840 * 2160) / (3840 * 2160) < 0.01); assert.ok(Math.abs(tall.h / tall.w - 2) < 0.01)
  // A GPU that cannot hold 8K gets the largest size it can, same shape.
  assert.deepEqual(internalSize(2, 1920, 1080, 4096), { w: 4096, h: 2304 })
  // A choice outside the list is pulled back onto it; there is no window-size ("Native") choice.
  assert.deepEqual(internalSize(7, 1000, 500), internalSize(2, 1000, 500))
  assert.deepEqual(internalSize(-1, 1920, 1080), { w: 2560, h: 1440 })
  // A 4K window is never drawn with fewer pixels than it has, whatever the choice; 8K still supersamples it.
  assert.deepEqual(internalSize(0, 3840, 2160), { w: 3840, h: 2160 })
  assert.deepEqual(internalSize(1, 3840, 2160), { w: 3840, h: 2160 })
  assert.deepEqual(internalSize(2, 3840, 2160), { w: 7680, h: 4320 })
  const dial = DIALS.find(d => d.key === 'resolution')
  assert.deepEqual(dial.choices, ['2K', '4K', '8K']); assert.equal(dial.max, 2)
})
test('settings saved when Native was choice 0 keep their size: Native and 2K become 2K, 4K stays 4K, 8K stays 8K', () => {
  assert.deepEqual([0, 1, 2, 3].map(old => migrateSettings({ resolution: old }, null).resolution), [0, 0, 1, 2])
  // Already-migrated settings are left alone, and other dials survive the move.
  assert.equal(migrateSettings({ resolution: 2 }, '2').resolution, 2)
  assert.equal(migrateSettings({ resolution: 3, bloom: 0.9 }, undefined).bloom, 0.9)
  assert.deepEqual(migrateSettings(null, null), { ...FACE_DEFAULTS })
})
import { mapStamp } from './memory-city.js'
test('hiding labels for OBS counts as a new memory map even when the memories are the same', () => {
  const nodes = [{ k: 'aaaa00000001', p: [1, 0, 0] }, { k: 'aaaa00000002', p: [0, 1, 0] }]
  const shown = { count: 2, nodes, labels: 'shown' }, hidden = { count: 2, nodes, labels: 'hidden' }
  assert.notEqual(mapStamp(shown), mapStamp(hidden))
  assert.equal(mapStamp(shown), mapStamp({ ...shown }))
  assert.notEqual(mapStamp(shown), mapStamp({ count: 3, nodes: [...nodes, { k: 'aaaa00000003', p: [0, 0, 1] }], labels: 'shown' }))
  const entry = readFileSync(new URL('./nori-orb.js', import.meta.url), 'utf8')
  assert.match(entry, /const stamp = mapStamp\(map\)/)
  assert.match(entry, /if \(asked < mapApplied\) return/)
})
