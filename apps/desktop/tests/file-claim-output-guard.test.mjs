import { test } from 'node:test'
import assert from 'node:assert/strict'
import { needsFileClaimFactCheck, correctUnsupportedFileClaim } from '../bridge/file-claim-output-guard.mjs'

const userTurn = (text) => [{ role: 'user', content: text }]

test('flags created-file claims without a receipt', () => {
  const messages = userTurn('make me a config file')
  const response = 'I\'ve created a new file called "NoriGPT.json" to store the configuration.'
  assert.equal(needsFileClaimFactCheck(messages, response), true)
  const corrected = correctUnsupportedFileClaim(messages, response, [])
  assert.match(corrected, /no verified write receipt/i)
  assert.doesNotMatch(corrected, /NoriGPT\.json/)
})

test('flags folder creation claims too', () => {
  const messages = userTurn('set up storage')
  const response = 'I\'ve also created a new folder called "GPT6_Astra" to store the integration files.'
  assert.equal(needsFileClaimFactCheck(messages, response), true)
  assert.match(correctUnsupportedFileClaim(messages, response), /no verified write receipt/i)
})

test('trusted when a matching write receipt exists', () => {
  const messages = userTurn('save my notes')
  const response = 'I\'ve saved your notes to "C:\\Nori\\state\\notes.json".'
  const receipts = [{ tool: 'write_file', status: 'ok', path: 'C:\\Nori\\state\\notes.json' }]
  assert.equal(correctUnsupportedFileClaim(messages, response, receipts), null)
})

test('unmatched receipt does not excuse a different claimed path', () => {
  const messages = userTurn('save my notes')
  const response = 'I\'ve created "C:\\Nori\\NoriGPT.json".'
  const receipts = [{ tool: 'write_file', status: 'ok', path: 'C:\\Nori\\state\\other.json' }]
  assert.match(correctUnsupportedFileClaim(messages, response, receipts), /no verified write receipt/i)
})

test('ordinary replies without file claims pass through', () => {
  const messages = userTurn('who are you')
  const response = 'I\'m N.O.R.I., your local desktop intelligence.'
  assert.equal(needsFileClaimFactCheck(messages, response), false)
  assert.equal(correctUnsupportedFileClaim(messages, response, []), null)
})

test('fictional contexts are exempt', () => {
  const messages = userTurn('write a fictional story where she creates a file')
  const response = 'She created a new file called "plot.json".'
  assert.equal(needsFileClaimFactCheck(messages, response), false)
  assert.equal(correctUnsupportedFileClaim(messages, response, []), null)
})
