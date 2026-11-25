import test from 'node:test'
import assert from 'node:assert/strict'
import {
  requestsNoriProjectRead,
  requestsNoriProjectReview,
  requestsReadOnlyProjectReview,
} from '../bridge/project-read-intent.mjs'

for (const goal of [
  'look thru your project loiok for ways to improve it',
  'look through your project for ways to improve it',
  'Inspect your code and tell me what to improve',
  'review your code for improvements',
  'go thru your project and find bugs',
]) {
  test(`recommendation request remains inspection only: ${goal}`, () => {
    assert.equal(requestsNoriProjectRead(goal), true)
    assert.equal(requestsNoriProjectReview(goal), true)
    assert.equal(requestsReadOnlyProjectReview(goal), true)
  })
}

for (const goal of [
  'improve your project',
  'look thru your project and improve it',
  ...['apply the changes', 'execute those changes', 'patch your code',
    'rewrite your code', 'optimize your code', 'install your code']
    .map(action => `look thru your project for ways to improve it then ${action}`),
]) {
  test(`an edit request cannot gain inspection precedence: ${goal}`, () => {
    assert.equal(requestsReadOnlyProjectReview(goal), false)
  })
}

for (const goal of [
  "don't look thru your project for ways to improve it",
  'look thru your project without tools',
  'The example is look thru your project for ways to improve it',
  'Good evening, how are you?',
]) {
  test(`constraints and conversation do not authorize a review: ${goal}`, () => {
    assert.equal(requestsReadOnlyProjectReview(goal), false)
  })
}
