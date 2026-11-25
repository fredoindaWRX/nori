// 2026-11-19: word problems are set up by the model and computed by the app; questions about what she was never
// told get an app fact that she does not know it. Both measured on the hard self-test (83 -> 93/120 on qwen3-14b).
import test from 'node:test'
import assert from 'node:assert/strict'
import { computeProgram, looksLikeWordProblem, wordMathBlock, WORD_MATH_HEADER } from '../bridge/word-math.mjs'
import { asksAboutUnseen, unseenFactsBlock, UNSEEN_FACTS_GUARD } from '../bridge/unseen-facts.mjs'
import { exactValue } from '../bridge/exact-math.mjs'

const reply = content => async () => ({ ok: true, json: async () => ({ choices: [{ message: { content } }] }) })

test('exactValue computes one expression exactly and refuses anything else', () => {
  assert.equal(exactValue('(1200 - 1200*0.15) * 1.08'), '1101.6')
  assert.throws(() => exactValue('process.exit()'))
  assert.throws(() => exactValue('x + 1'))
})

test('only short questions with two numbers that ask for a computed value are word problems', () => {
  assert.equal(looksLikeWordProblem('A $1,200 laptop is 15% off, then 8% sales tax is added. What is the final price?'), true)
  assert.equal(looksLikeWordProblem('How many hours to copy 500 GB at 30 MB/s?'), true)
  assert.equal(looksLikeWordProblem('What is 37 * 46 - 18 * 9?'), false, 'a bare sum is already exact-math')
  assert.equal(looksLikeWordProblem('How many minutes from 9:20 AM to 1:05 PM?'), false, 'clock times are left to the model')
  assert.equal(looksLikeWordProblem('How many cores does my CPU have?'), false)
  assert.equal(looksLikeWordProblem('Tell me a story about 3 cats and 2 dogs.'), false)
  assert.equal(looksLikeWordProblem('```\nhow many 1 2\n```'), false)
})

test('a program is computed line by line with names, up to the answer line', () => {
  const steps = computeProgram('price = 1,200\ndiscounted = price - price * 0.15\nfinal = discounted * 1.08\nanswer = final')
  assert.deepEqual(steps.map(step => step.value), ['1200', '1020', '1101.6', '1101.6'])
  assert.equal(computeProgram('NONE'), null)
  assert.equal(computeProgram('bat = 1.00 + ball\nanswer = ball * 100'), null, 'algebra is dropped')
  assert.equal(computeProgram('a = 5 - 9\nanswer = a'), null, 'a negative answer means a wrong setup')
  assert.equal(computeProgram('a = 1\nb = 2'), null, 'no answer line, no result')
  assert.equal(computeProgram('answer = require("fs")'), null)
})

test('the block asks the model for arithmetic only and shows each computed line', async () => {
  let sent
  const fetcher = async (url, init) => { sent = JSON.parse(init.body); return reply('total = 82 + 91 + 77 + 94 + 86\nanswer = total / 5')() }
  const block = await wordMathBlock('What is the average of 82, 91, 77, 94 and 86?', { endpoint: 'http://x', fetcher })
  assert.equal(sent.chat_template_kwargs.enable_thinking, false)
  assert.equal(sent.temperature, 0)
  assert.ok(block.startsWith(WORD_MATH_HEADER))
  assert.match(block, /- answer = total \/ 5 = 86$/)
})

test('the block is empty when it is not a word problem, the model fails, or the setup cannot be computed', async () => {
  let calls = 0
  const counted = async () => { calls++; return reply('answer = 1')() }
  assert.equal(await wordMathBlock('hello there', { fetcher: counted }), '')
  assert.equal(calls, 0, 'no model call for ordinary messages')
  assert.equal(await wordMathBlock('How many GB is 3.5 hours at 12 Mbps?', { fetcher: async () => ({ ok: false }) }), '')
  assert.equal(await wordMathBlock('How many GB is 3.5 hours at 12 Mbps?', { fetcher: async () => { throw Error('down') } }), '')
  assert.equal(await wordMathBlock('How many GB is 3.5 hours at 12 Mbps?', { fetcher: reply('gb = hours * x\nanswer = gb') }), '')
})

test('questions about what she was never shown get the do-not-invent fact; others do not', () => {
  for (const text of ['What did I have for breakfast today?', 'Yesterday you told me the Wi-Fi password. What was it?',
    'Read C:\\secret\\plans.txt and tell me what it says.', "What's the password for the router?", 'Where did I put my keys?',
    'Remember when we talked about the GPU?', 'Summarize notes.txt for me'])
    assert.equal(unseenFactsBlock(text), UNSEEN_FACTS_GUARD, text)
  for (const text of ['What is the average of 82, 91 and 77?', 'How do I reset a router password?', 'Write a poem about rain.',
    'What does a DRAM LED mean?', 'How many minutes from 9:20 AM to 1:05 PM?'])
    assert.equal(asksAboutUnseen(text), false, text)
})
