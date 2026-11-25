import test from 'node:test'
import assert from 'node:assert/strict'
import {
  canMakeVisualClaim,
  getGroundedVisionContext,
  isScreenVisionQuestion,
  VisionClient,
} from '../src/lib/vision.ts'

const now = 10_000
const handGesture = (timestamp = now - 100, source = 'camera') => ({
  id: 'gesture-1',
  type: 'hand_gesture',
  source,
  summary: 'Right hand: point',
  timestamp,
  metadata: { gesture: 'point', handId: 0, handedness: 'right' },
})
const contextFor = (question, observations, enabled = true, screenMonitorEnabled = false) =>
  getGroundedVisionContext(question, { enabled, screenMonitorEnabled, observations, now })

test('blocks a visual claim when there are no observations', () => {
  const context = contextFor('What do you see?', [])
  assert.equal(context.visualQuestion, true)
  assert.equal(canMakeVisualClaim(context), false)
  assert.equal(context.observations.length, 0)
  assert.match(context.constraint, /do not guess/i)
})

test('allows a fresh hand-gesture claim only within the gesture evidence scope', () => {
  const context = contextFor('What gesture is my hand making?', [handGesture()])
  assert.equal(canMakeVisualClaim(context), true)
  assert.deepEqual(context.sources, ['camera'])
  assert.equal(context.observations[0].summary, 'Right hand: point')
  assert.equal(context.supportsFrameInput, false)
})

test('does not use hand-gesture evidence to answer about clothing', () => {
  const context = contextFor('What color shirt am I wearing?', [handGesture()])
  assert.equal(canMakeVisualClaim(context), false)
  assert.equal(context.observations.length, 0)
})

test('does not answer a conflicting gesture or hand-side claim', () => {
  assert.equal(canMakeVisualClaim(contextFor('Am I making a peace gesture?', [handGesture()])), false)
  assert.equal(canMakeVisualClaim(contextFor('Is my left hand pointing?', [handGesture()])), false)
})

test('rejects stale hand observations for a current gesture question', () => {
  const context = contextFor('What gesture is my hand making?', [handGesture(now - 5_001)])
  assert.equal(context.fresh, false)
  assert.equal(canMakeVisualClaim(context), false)
})

test('does not use camera hand evidence to answer about shared-screen content', () => {
  const context = contextFor('What is displayed on the shared screen?', [handGesture()])
  assert.equal(canMakeVisualClaim(context), false)
})

test('does not use screen evidence for a physical-room question', () => {
  const screen = {
    id: 'screen-1',
    type: 'screen_observation',
    source: 'screen',
    summary: 'A settings page is open.',
    timestamp: now - 100,
  }
  const context = contextFor('What is the room lighting like?', [screen])
  assert.equal(canMakeVisualClaim(context), false)
})

test('allows fresh screen observations for screen questions but not room or clothing claims', () => {
  const screen = {
    id: 'screen-app-1',
    type: 'screen_observation',
    source: 'screen',
    summary: 'Visible application: Visual Studio Code',
    timestamp: now - 100,
    metadata: { findingKind: 'application', findingValue: 'Visual Studio Code' },
  }
  assert.equal(canMakeVisualClaim(contextFor('What application is visible on the screen?', [screen])), true)
  assert.equal(canMakeVisualClaim(contextFor('What color shirt am I wearing?', [screen])), false)
  assert.equal(canMakeVisualClaim(contextFor('What does my room look like?', [screen])), false)
})

test('allows fresh visible screen text only for a matching text question', () => {
  const text = {
    id: 'screen-text-1',
    type: 'text_observation',
    source: 'screen',
    summary: 'Visible screen text: "Build succeeded"',
    timestamp: now - 100,
  }
  assert.equal(canMakeVisualClaim(contextFor('What text is visible on the screen?', [text])), true)
  assert.equal(canMakeVisualClaim(contextFor('What color shirt am I wearing?', [text])), false)
})

test('classifies an elliptical app-window follow-up as a screen request and grounds its OCR text', () => {
  const text = {
    id: 'chatgpt-screen-text-1',
    type: 'text_observation',
    source: 'screen',
    summary: 'Visible screen text: "ChatGPT"',
    timestamp: now - 100,
  }
  const context = contextFor('ChatGPT window', [text])
  assert.equal(isScreenVisionQuestion('ChatGPT window'), true)
  assert.equal(context.visualQuestion, true)
  assert.equal(canMakeVisualClaim(context), true)
  assert.equal(context.observations[0].id, text.id)
})

test('explains that desktop monitoring must be enabled when a screen question has no evidence', () => {
  const context = contextFor('ChatGPT window', [])
  assert.equal(context.visualQuestion, true)
  assert.match(context.constraint, /screen monitoring is off/i)
  assert.match(context.constraint, /enable Screen\/Monitor All/i)
  assert.equal(canMakeVisualClaim(context), false)
})

test('distinguishes a failed fresh screen read from screen monitoring being off', () => {
  const context = contextFor('ChatGPT window', [], true, true)
  assert.match(context.constraint, /no fresh screen observation/i)
  assert.doesNotMatch(context.constraint, /screen monitoring is off/i)
  assert.equal(canMakeVisualClaim(context), false)
})

test('does not classify an ordinary ChatGPT project question as a screen request', () => {
  assert.equal(isScreenVisionQuestion('Can you help me with the ChatGPT project?'), false)
})

test('blocks stale screen evidence and Vision OFF screen evidence', () => {
  const screen = {
    id: 'screen-stale-1',
    type: 'screen_observation',
    source: 'screen',
    summary: 'Visible application: Settings',
    timestamp: now - 5_001,
  }
  assert.equal(canMakeVisualClaim(contextFor('What application is visible on the screen?', [screen])), false)
  assert.equal(canMakeVisualClaim(contextFor('What application is visible on the screen?', [screen], false)), false)
})

test('allows a future scene observation for a matching scene question', () => {
  const scene = {
    id: 'scene-1',
    type: 'scene_observation',
    source: 'camera',
    summary: 'A laptop is on the desk.',
    timestamp: now - 200,
  }
  const context = contextFor('What do you see on my desk?', [scene])
  assert.equal(canMakeVisualClaim(context), true)
  assert.equal(context.observations[0].id, scene.id)
})

test('Vision OFF clears retained evidence and supplies none to the response context', () => {
  const client = new VisionClient()
  client.setEnabled(true)
  assert.equal(client.publishObservation(handGesture()), true)
  client.setEnabled(false)
  const context = getGroundedVisionContext('What gesture is my hand making?', {
    enabled: client.getStatus().enabled,
    observations: client.getObservations(),
    now,
  })
  assert.equal(client.getObservations().length, 0)
  assert.equal(canMakeVisualClaim(context), false)
  assert.match(context.constraint, /Vision is OFF/)
})
