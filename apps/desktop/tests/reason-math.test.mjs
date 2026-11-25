// 2026-11-21: clock-hand angles, ordering puzzles and one-unknown word problems, all computed by the app.
import test from 'node:test'
import assert from 'node:assert/strict'
import { timeMathBlock } from '../bridge/time-math.mjs'
import { orderFactsBlock, comparisons, uniqueOrder } from '../bridge/order-facts.mjs'
import { computeProgram, solveLinear, wordMathBlock } from '../bridge/word-math.mjs'

test('clock-hand angle', () => {
  const at = p => timeMathBlock(`A clock shows ${p}. What is the angle between the hour hand and the minute hand, in degrees?`)
  assert.match(at('3:15'), /angle between them is 7\.5°/)
  assert.match(at('9:00'), /angle between them is 90°/)
  assert.match(at('12:30'), /angle between them is 165°/)
  assert.match(at('6:00'), /angle between them is 180°/)
  // Not an angle question: no angle line.
  assert.doesNotMatch(timeMathBlock('The clock shows 3:15. Is that late?'), /angle/)
})

test('ordering puzzle gives the full order and ranks', () => {
  const block = orderFactsBlock('Ann is taller than Ben. Ben is taller than Cara. Dan is shorter than Cara. Who is the second shortest? One name.')
  assert.match(block, /From tallest to shortest: Ann, Ben, Cara, Dan\./)
  assert.match(block, /So the second shortest is Cara\./)
  assert.doesNotMatch(block, /Ann is the/) // only the asked rank, not every rank
  const oldest = orderFactsBlock('Eve is younger than Fay. Gus is older than Fay. Who is oldest?')
  assert.match(oldest, /From oldest to youngest: Gus, Fay, Eve\./)
  assert.match(oldest, /So the oldest is Gus\./)
  // No single rank asked: every rank is listed.
  assert.match(orderFactsBlock('Ann is taller than Ben. Ben is taller than Cara. Put them in order.'), /Ben is the second tallest and the second shortest\./)
})

test('ordering stays silent when the order is open, contradictory or too small', () => {
  assert.equal(orderFactsBlock('Ann is taller than Ben. Ann is taller than Cara. Who is shortest?'), '') // Ben vs Cara open
  assert.equal(uniqueOrder(comparisons('Ann is taller than Ben. Ben is taller than Cara. Cara is taller than Ann.')), null)
  assert.equal(orderFactsBlock('Ann is taller than Ben.'), '')
  assert.equal(orderFactsBlock('Ann is taller than Ben. Ben is older than Cara. Cara is faster than Dan.'), '') // mixed measures
  assert.equal(orderFactsBlock('Paris is better than Rome. Rome is better than Oslo.'), '') // unknown comparison word
})

test('solve: one linear unknown, exact', () => {
  assert.equal(solveLinear('ball + (ball + 1.00)', '1.10').value, '0.05')
  assert.equal(solveLinear('(b + 2) + b + 2*b', '22').value, '5')
  assert.equal(solveLinear('x*x', '4'), null) // not linear
  assert.equal(solveLinear('x + y', '4'), null) // two unknowns
  assert.equal(solveLinear('3', '4'), null) // no unknown
  assert.equal(solveLinear('x - x', '0'), null) // no single root
})

test('programs with a solve line (bat and ball, three boxes)', () => {
  const bat = computeProgram('solve: ball + (ball + 1.00) = 1.10\nanswer = ball * 100')
  assert.equal(bat.at(-1).value, '5')
  const boxes = computeProgram('solve: (b + 2) + b + 2 * b = 22\nc = 2 * b\nanswer = c')
  assert.equal(boxes.at(-1).value, '10')
  // A name may be defined in terms of the unknown before the equation.
  assert.equal(computeProgram('c = 2 * b\nsolve: b + 2 = 4\nanswer = c').at(-1).value, '4')
})

test('the natural form her model writes (measured 2026-11-21), and setups the app must refuse', () => {
  assert.equal(computeProgram('bat = ball + 1.00\nbat + ball = 1.10\nanswer = ball * 100').at(-1).value, '5')
  assert.equal(computeProgram('boxB = boxB\nboxA = boxB + 2\nboxC = boxB * 2\nboxA + boxB + boxC = 22\nanswer = boxC').at(-1).value, '10')
  assert.equal(computeProgram('bat = ball + 1\nanswer = ball'), null) // unknown with no equation
  assert.equal(computeProgram('a = x + y\na + x = 3\nanswer = a'), null) // two unknowns
  assert.equal(computeProgram('a = 2\na + 1 = 4\nanswer = a'), null) // an equation with no unknown is a contradiction or noise
  assert.equal(computeProgram('price = 1200\ntotal = price * 0.85 * 1.08\nanswer = total').at(-1).value, '1101.6') // plain programs unchanged
})

test('wordMathBlock shows the solved unknown in the app fact', async () => {
  const fetcher = async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: 'solve: ball + (ball + 1.00) = 1.10\nanswer = ball * 100' } }] }) })
  const block = await wordMathBlock('A bat and a ball cost $1.10 together. The bat costs $1.00 more than the ball. How many cents does the ball cost?', { fetcher })
  assert.match(block, /- ball = ball \+ \(ball \+ 1\.00\) = 1\.10 = 0\.05/)
  assert.match(block, /- answer = ball \* 100 = 5/)
})
