import test from 'node:test'
import assert from 'node:assert/strict'
import { DEFAULT_SPEECH_EXPRESSION, speechExpression, validateSpeechExpression } from '../bridge/speech-expression.mjs'

const snapshot = (patch = {}) => ({
  mode: 'ready',
  appliedProfile: { enthusiasm: 40 },
  affect: { joy: 20, amusement: 35, excitement: 12, concern: 8, frustration: 5, urgency: 0, uncertainty: 10 },
  ...patch,
})

test('neutral affect preserves the established local voice cadence', () => {
  assert.deepEqual(speechExpression(null), DEFAULT_SPEECH_EXPRESSION)
})

test('positive affect modestly changes cadence without exceeding supported values', () => {
  const result = speechExpression(snapshot({
    mode: 'celebrating', appliedProfile: { enthusiasm: 100 },
    affect: { joy: 100, amusement: 100, excitement: 100, concern: 0, frustration: 0, urgency: 0, uncertainty: 0 },
  }))
  assert.ok(result.speed > 1 && result.speed <= 1.04)
  assert.ok(result.pitch >= 0.98 && result.pitch <= 1.06)
  assert.ok(result.sentencePause >= 0.18 && result.sentencePause <= 0.27)
})

test('supportive affect stays calm even when joy and excitement are high', () => {
  const result = speechExpression(snapshot({
    mode: 'supportive', appliedProfile: { enthusiasm: 100 },
    affect: { joy: 100, amusement: 100, excitement: 100, concern: 100, frustration: 100, urgency: 100, uncertainty: 100 },
  }))
  assert.ok(result.speed < 1 && result.speed >= 0.94)
  assert.ok(result.sentencePause >= 0.22 && result.sentencePause <= 0.3)
})

test('bridge validation rejects extra, nonfinite, or out-of-range prosody controls', () => {
  assert.deepEqual(validateSpeechExpression(undefined), DEFAULT_SPEECH_EXPRESSION)
  assert.throws(() => validateSpeechExpression({ ...DEFAULT_SPEECH_EXPRESSION, unbounded: 1 }))
  assert.throws(() => validateSpeechExpression({ ...DEFAULT_SPEECH_EXPRESSION, speed: 1.5 }))
  assert.throws(() => validateSpeechExpression({ ...DEFAULT_SPEECH_EXPRESSION, pitch: NaN }))
})
