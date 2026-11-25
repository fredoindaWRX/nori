import test from 'node:test'
import assert from 'node:assert/strict'
import { nameDeclaration, savedNameAnswer } from '../bridge/personal-name.mjs'
test('self-introduction preserves spelling and excludes adjacent biography', () => {
  assert.equal(nameDeclaration('my name si ana maria soto jr born in Lowell 1988 loves cars'), 'ana maria soto jr')
  assert.equal(nameDeclaration('My name is Ana María Soto Jr., born in a city.'), 'Ana María Soto Jr.')
  assert.equal(nameDeclaration('Call me Ana'), 'Ana')
})
test('quoted text, questions, and unrelated statements are not name declarations', () => {
  for (const text of ['Someone said my name is Ana', 'What is my name?', '"My name is Ana"', 'My name is https://example.com', 'I love Subarus']) assert.equal(nameDeclaration(text), null)
})
test('name answers use knowledge records only and prefer the latest explicit statement', () => {
  const entries = [{ kind: 'knowledge', text: 'User-provided name: Ana', at: '2026-01-01' },
    { kind: 'knowledge', text: 'User-provided name: María', at: '2026-02-01' },
    { kind: 'feedback', text: 'User-provided name: Wrong', at: '2026-03-01' }]
  assert.equal(savedNameAnswer('whats my name', entries), 'You told me your name is María.')
  assert.equal(savedNameAnswer('im good you know my name', entries), 'You told me your name is María.')
  assert.match(savedNameAnswer('what is my name?', []), /do not have a verified saved name/)
  assert.equal(savedNameAnswer('Write a story about my name', entries), null)
})

test('name answers prefer the later record when timestamps are equal', () => {
  const entries = ['Earlier', 'Current'].map(name => ({kind:'knowledge',text:`User-provided name: ${name}`,at:'2026-01-01T00:00:00.000Z'}))
  assert.equal(savedNameAnswer('whats my name', entries), 'You told me your name is Current.')
})

test('name answers ignore malformed catalog records', () => {
  assert.equal(savedNameAnswer('whats my name', [null, 7, {}, {kind:'knowledge',text:'User-provided name: Ana',at:'2026-01-01'}]), 'You told me your name is Ana.')
})
