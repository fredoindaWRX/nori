import test from 'node:test'
import assert from 'node:assert/strict'
import { parseScreenAlert } from '../bridge/screen-monitor.mjs'

test('screen monitor stays silent on a clean screen', () => {
  assert.equal(parseScreenAlert('NO_ALERT'), null)
  assert.equal(parseScreenAlert('NO_ALERT.'), null)
  assert.equal(parseScreenAlert('<think>checking</think> NO_ALERT'), null)
})

test('screen monitor accepts only a short explicit blocker alert', () => {
  assert.equal(parseScreenAlert('ALERT: The app shows a connection error.'), 'The app shows a connection error.')
  assert.equal(parseScreenAlert('There is an error on screen.'), null)
})

test('screen monitor suppresses private data and verbose model output', () => {
  assert.equal(parseScreenAlert('ALERT: A verification code is visible.'), null)
  assert.equal(parseScreenAlert(`ALERT: ${'word '.repeat(36)}`), null)
})
