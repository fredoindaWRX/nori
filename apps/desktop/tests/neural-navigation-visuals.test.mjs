import test from 'node:test'
import assert from 'node:assert/strict'
import { showFineNeuralDetail, showNeuralAtmosphere } from '../src/scene/neural-navigation-visuals.ts'

test('fine anatomy is omitted only while camera controls are moving', () => {
  assert.equal(showFineNeuralDetail(true), false)
  assert.equal(showFineNeuralDetail(false), true)
})

test('volumetric atmosphere is omitted during movement and while fully faded out', () => {
  assert.equal(showNeuralAtmosphere(true, 1), false)
  assert.equal(showNeuralAtmosphere(false, 0), false)
  assert.equal(showNeuralAtmosphere(false, 0.009), false)
  assert.equal(showNeuralAtmosphere(false, 0.01), true)
  assert.equal(showNeuralAtmosphere(false, 0.5), true)
  assert.equal(showNeuralAtmosphere(false, Number.NaN), false)
})
