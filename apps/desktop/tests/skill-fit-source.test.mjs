import test from 'node:test'
import assert from 'node:assert/strict'
import { skillFitQuestion } from '../bridge/tool-intent.mjs'

test('skill suitability questions remain distinct from execution requests', () => {
  for (const text of ['Which skill would help me reverse engineer Discord?', 'Do you have a tool for reading PDFs?', 'Can your tools help with coding?']) assert.equal(skillFitQuestion(text), true, text)
  for (const text of ['Use REA to inspect this app', 'Run the coding task', 'List your installed skills', 'hello']) assert.equal(skillFitQuestion(text), false, text)
  assert.equal(skillFitQuestion('Which skill would help me ' + 'x'.repeat(4000)), false)
})
