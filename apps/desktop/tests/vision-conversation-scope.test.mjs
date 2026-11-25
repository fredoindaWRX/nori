import test from 'node:test'
import assert from 'node:assert/strict'
import { getGroundedVisionContext, canMakeVisualClaim } from '../src/lib/vision.ts'

test('ordinary microphone conversation does not request an unsolicited vision disclaimer', () => {
  for (const enabled of [false, true]) {
    const context = getGroundedVisionContext("I was calling you, maybe you weren't picking up my mic", {
      enabled, observations: [], now: 10000,
    })
    assert.equal(context.visualQuestion, false)
    assert.equal(canMakeVisualClaim(context), false)
    assert.match(context.constraint, /do not mention.*unless.*asks/i)
    assert.doesNotMatch(context.constraint, /State that current visual evidence is unavailable\./)
  }
})

test('visual question still requires an honest unavailable-evidence response', () => {
  const context = getGroundedVisionContext('What do you see on my screen?', {
    enabled: false, observations: [], now: 10000,
  })
  assert.equal(context.visualQuestion, true)
  assert.equal(canMakeVisualClaim(context), false)
  assert.match(context.constraint, /State that current visual evidence is unavailable\./)
})
