import test from 'node:test'
import assert from 'node:assert/strict'
import { needsCouncil } from '../bridge/local-chat.mjs'
test('React closure questions are not live-data requests; action and external-data gates remain', () => {
  assert.equal(needsCouncil('In React useState, explain incrementing the latest count.'), false)
  assert.equal(needsCouncil('React latest news'), true)
  assert.equal(needsCouncil('React latest count and today\'s weather'), true)
  assert.equal(needsCouncil('Fix my React code to increment the latest count'), true)
  assert.equal(needsCouncil('latest count on my computer'), true)
})
