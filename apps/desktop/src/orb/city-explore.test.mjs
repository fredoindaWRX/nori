import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { askText, findMemories, nearestOnScreen } from './city-explore.js'

test('a click picks the block under the pointer, the nearer one when two overlap, and nothing in empty space', () => {
  const points = [{ x: 100, y: 100, depth: 9, reach: 12 }, { x: 108, y: 104, depth: 3, reach: 30 }, null, { x: 600, y: 300, depth: 2, reach: 10 }, { x: 110, y: 100, depth: -1, reach: 50 }]
  assert.equal(nearestOnScreen(points, 104, 102), 1)
  assert.equal(nearestOnScreen(points, 598, 303), 3)
  assert.equal(nearestOnScreen(points, 900, 700), -1)
  assert.equal(nearestOnScreen([], 10, 10), -1)
  // A big close block is picked anywhere on its face, not only near its centre.
  assert.equal(nearestOnScreen([{ x: 400, y: 400, depth: 1.5, reach: 140 }], 520, 430), 0)
})

test('find matches every word against title, kind, day and key, best title match first', () => {
  const blocks = [
    { k: 'aaaa11112222', l: { kind: 'memory', day: '2026-11-02', title: 'the lights in the studio' } },
    { k: 'bbbb33334444', l: { kind: 'exchange', day: '2026-11-05', title: 'studio lights turned blue for the stream' } },
    { k: 'cccc55556666' },
    { k: 'dddd77778888', l: { kind: 'journal', day: '2026-11-05', title: 'a quiet day' } },
  ]
  assert.deepEqual(findMemories(blocks, 'studio lights'), [1, 0])
  assert.deepEqual(findMemories(blocks, '2026-11-05'), [1, 3])
  assert.deepEqual(findMemories(blocks, 'cccc5555'), [2])
  assert.deepEqual(findMemories(blocks, 'journal quiet'), [3])
  assert.deepEqual(findMemories(blocks, ''), [])
  assert.deepEqual(findMemories(blocks, 'nothing like this'), [])
  assert.equal(findMemories(Array.from({ length: 40 }, (_, i) => ({ k: `k${i}`, l: { title: `note ${i}` } })), 'note').length, 8)
})

test('asking about a block is an ordinary short chat message, and a block with no words cannot be asked about', () => {
  assert.equal(askText({ l: { day: '2026-11-05', title: 'studio   lights turned blue' } }), 'Tell me what you remember about this from 2026-11-05: "studio lights turned blue"')
  assert.equal(askText({ l: { day: 'not a day', title: 'x'.repeat(200) } }), `Tell me what you remember about this: "${'x'.repeat(80)}"`)
  assert.equal(askText({ k: 'abc' }), '')
  assert.equal(askText(null), '')
})

test('the window never asks the page for memory text, and the face hands the camera over only while inside', () => {
  const source = readFileSync(new URL('./city-explore.js', import.meta.url), 'utf8')
  assert.ok(!/fetch\(|XMLHttpRequest|WebSocket/.test(source), 'the explore module makes no network requests')
  const scene = readFileSync(new URL('./crystal-scene.js', import.meta.url), 'utf8')
  assert.match(scene, /createCityExplore\(\{ THREE, container, canvas, camera, camPos, getCity: \(\) => city, isInside: \(\) => phase === 'in', onAsk,/)
  assert.match(scene, /if \(explore\.active\(\)\) explore\.fly\(dt\)/)
  assert.match(scene, /if \(thinkOwn && !autoDiving && !exploring\(\)\) setRecall\(false, true\)/)
})
