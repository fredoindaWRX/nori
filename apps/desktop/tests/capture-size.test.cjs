const test = require('node:test')
const assert = require('node:assert/strict')
const { captureSize, displayImages } = require('../desktop/capture-size.cjs')

test('monitor thumbnails preserve portrait, ultrawide and landscape proportions', () => {
  assert.deepEqual(captureSize({ width: 1080, height: 1920 }), { width: 405, height: 720 })
  assert.deepEqual(captureSize({ width: 3440, height: 1440 }), { width: 1280, height: 536 })
  assert.deepEqual(captureSize({ width: 3840, height: 2160 }), { width: 1280, height: 720 })
  assert.deepEqual(captureSize({ width: 640, height: 480 }), { width: 640, height: 480 })
})

test('invalid monitor dimensions are rejected', () => {
  assert.throws(() => captureSize({ width: 0, height: 100 }), /Invalid/)
  assert.throws(() => captureSize({ width: Infinity, height: 100 }), /Invalid/)
})

test('all-screen capture matches source identities and does not truncate at six displays', () => {
  const displays = Array.from({ length: 8 }, (_, id) => ({ id, size: { width: 1920, height: 1080 } }))
  const sources = displays.map(display => ({ display_id: String(display.id), thumbnail: {
    isEmpty: () => false, resize: () => ({ toDataURL: () => `image-${display.id}` }),
  } })).reverse()
  assert.deepEqual(displayImages(displays, sources).map(frame => frame.image), displays.map(display => `image-${display.id}`))
  assert.throws(() => displayImages(displays, sources.slice(1)), /incomplete/)
})
