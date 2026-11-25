import test from 'node:test'
import assert from 'node:assert/strict'
import { bidirectionalPulse, regionHighlight, solarFlareColor, sparseNeuralPulse } from '../src/scene/neural-visuals.ts'

test('hovered or selected region is vivid and other regions recede', () => {
  assert.equal(regionHighlight('language', null), 1)
  assert.ok(regionHighlight('language', 'language') > 2)
  assert.ok(regionHighlight('tools', 'language') < .2)
})

test('active local connection shows bright sparks traveling in both directions', () => {
  const time = .25
  const forward = bidirectionalPulse(.12, time, 0, 1)
  const reverse = bidirectionalPulse(.88, time, 0, 1)
  assert.ok(forward > 1.4, `forward pulse should be conspicuous; got ${forward}`)
  assert.ok(reverse > 1.4, `reverse pulse should be conspicuous; got ${reverse}`)
  assert.equal(bidirectionalPulse(.12, time, 0, 0), 0)
})

test('inactive or invalid connections never fabricate signal brightness', () => {
  assert.equal(bidirectionalPulse(.4, 1, 0, 0), 0)
  assert.equal(bidirectionalPulse(Number.NaN, 1, 0, 1), 0)
})

test('observed activity produces deterministic sparse firing, not an all-on graph', () => {
  const pulse = sparseNeuralPulse(3, 1.25, .8)
  assert.ok(pulse >= 0 && pulse <= .8)
  assert.equal(sparseNeuralPulse(3, 1.25, .8), pulse)
  assert.equal(sparseNeuralPulse(3, 1.25, 0), 0)
  assert.equal(sparseNeuralPulse(-1, 1.25, 1), 0)
  const lit = Array.from({ length: 1000 }, (_, index) => sparseNeuralPulse(index, 1.25, 1) > .1).filter(Boolean).length
  assert.ok(lit > 0 && lit < 100, `expected a sparse subset to fire; got ${lit}/1000`)
})

test('active fibers use a blue, ultraviolet, coral, and gold flare spectrum', () => {
  const blue = solarFlareColor(0), ultraviolet = solarFlareColor(.42), gold = solarFlareColor(1)
  assert.ok(blue[2] > blue[0] * 3)
  assert.ok(ultraviolet[0] > ultraviolet[1] * .8)
  assert.ok(gold[0] > .95 && gold[1] > .8)
  assert.deepEqual(solarFlareColor(-1), blue)
  assert.deepEqual(solarFlareColor(2), gold)
})
