// 2026-11-22: the app checks her finished reply against the result its own code computed.
import test from 'node:test'
import assert from 'node:assert/strict'
import { answerCheckNote, expectedResult, replyMatches, CHECKED_NOTE } from '../bridge/answer-check.mjs'
import { exactMathBlock } from '../bridge/exact-math.mjs'
import { timeMathBlock } from '../bridge/time-math.mjs'
import { orderFactsBlock } from '../bridge/order-facts.mjs'

const wordFacts = "[Worked out by Nori's app: the model wrote the arithmetic, the app computed each line exactly. Give the answer line as the result.]\n- ball = ball + (ball + 1.00) = 1.10 = 0.05\n- answer = ball * 100 = 5"

test('a matching reply gets the checked line; a wrong one gets the computed answer', () => {
  assert.equal(answerCheckNote(wordFacts, 'The ball costs 5 cents.'), CHECKED_NOTE)
  assert.match(answerCheckNote(wordFacts, 'The ball costs 10 cents.'), /the computed answer is 5\. My reply above does not match it/)
  const sum = exactMathBlock('What is 37 * 46 - 18 * 9? Just the number.')
  assert.equal(answerCheckNote(sum, '1,540'), CHECKED_NOTE)
  assert.match(answerCheckNote(sum, '1504'), /computed answer is 1540/)
})

test('money, angles and names', () => {
  assert.ok(replyMatches({ kind: 'number', value: 1101.6 }, 'The final price is $1,101.60.'))
  assert.ok(!replyMatches({ kind: 'number', value: 1101.6 }, 'The final price is $1,101.66.'))
  const angle = timeMathBlock('A clock shows 3:15. What is the angle between the hour hand and the minute hand, in degrees?')
  assert.equal(answerCheckNote(angle, '7.5 degrees'), CHECKED_NOTE)
  assert.match(answerCheckNote(angle, '0 degrees, the hands overlap'), /computed answer is 7\.5°/)
  const order = orderFactsBlock('Ann is taller than Ben. Ben is taller than Cara. Dan is shorter than Cara. Who is the second shortest? One name.')
  assert.equal(answerCheckNote(order, 'Cara'), CHECKED_NOTE)
  assert.match(answerCheckNote(order, 'Ben'), /computed answer is Cara/)
})

test('approximate results allow ordinary rounding', () => {
  const third = exactMathBlock('what is 1/3 + 2')
  assert.equal(answerCheckNote(third, 'About 2.33.'), CHECKED_NOTE)
  assert.match(answerCheckNote(third, 'About 2.5.'), /computed answer is 2\.33333333333/)
})

test('silent when there is nothing to check, more than one result, or no reply', () => {
  assert.equal(answerCheckNote('', 'Hello'), '')
  assert.equal(answerCheckNote(wordFacts, ''), '')
  assert.equal(expectedResult(exactMathBlock('what is 2+2 and 3*7')), null) // two calculations: ambiguous
  assert.equal(answerCheckNote("[Unseen facts]\n- You were not shown his day.", 'I do not know.'), '')
})
