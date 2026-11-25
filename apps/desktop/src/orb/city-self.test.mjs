import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { besidePoint, nextWorkBlock } from './city-self.js'

test('she never picks the block she is already at, and copes with tiny cities', () => {
  assert.equal(nextWorkBlock(0, -1), -1); assert.equal(nextWorkBlock(1, 0), 0)
  for (const r of [0, 0.3, 0.5, 0.999, 1]) { const i = nextWorkBlock(10, 5, () => r); assert.ok(i >= 0 && i < 10 && i !== 5, String(r)) }
  assert.equal(nextWorkBlock(10, 5, () => 0.5), 6)
})

test('called, she stands ahead of the camera, to its right and a little low', () => {
  assert.deepEqual(besidePoint([1, 2, 3], [0, 0, -1], [1, 0, 0]).map(v => +v.toFixed(2)), [1.95, 1.78, 0.7])
})

test('the scene wires her in: thinking sends her to the pulled block, and looking around is not held to 30 fps', () => {
  const scene = fs.readFileSync(new URL('./crystal-scene.js', import.meta.url), 'utf8'), explore = fs.readFileSync(new URL('./city-explore.js', import.meta.url), 'utf8')
  const float = fs.readFileSync(new URL('./float.js', import.meta.url), 'utf8')
  assert.ok(scene.includes('self.goTo(i, now)') && scene.includes('self.goTo(target)') && scene.includes("self.update(now, dt, t, phase === 'in', fx, thinkDive)"))
  assert.ok(scene.includes('if (maxFps && !explore.active() && now - lastFrame < 1000 / maxFps) return'))
  assert.ok(scene.includes("if (city && phase !== 'out') insidePending = true"), 'no city rebuild under the owner')
  assert.ok(explore.includes("if (press?.moved && !free && isInside() && getCity()) take()"), 'a drag takes the camera without a key first')
  assert.ok(explore.includes("event.code === 'KeyN'"))
  assert.ok(float.includes("inForm(event) && !face?.insideCity?.()"), 'no window-drag press in the middle of the screen while inside')
})
