import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { cardFamily, cardFraction, cardsPerBlock, cardText, GRID, SLOTS, TILE, ATLAS } from './city-cards.js'

test('every block gets as many cards as fit in the atlas, between one and three', () => {
  assert.equal(GRID * TILE, ATLAS); assert.equal(SLOTS, GRID * GRID)
  assert.equal(cardsPerBlock(10), 3); assert.equal(cardsPerBlock(499), 2); assert.equal(cardsPerBlock(900), 1); assert.equal(cardsPerBlock(5000), 1); assert.equal(cardsPerBlock(0), 3)
})

test('a block gets the picture for what it is', () => {
  const kind = k => cardFamily({ l: { kind: k } })
  assert.deepEqual(['conversation', 'journal', 'knight', 'model', 'cloud', 'connector', 'skill', 'folder', 'project', 'score'].map(kind), ['talk', 'page', 'knight', 'model', 'model', 'system', 'skill', 'folder', 'project', 'score'])
  assert.equal(cardFamily({ k: 'abc' }), 'memory'); assert.equal(cardFamily({ x: {}, l: { kind: 'odd' } }), 'system')
})

test('the words on a card are only what the page already has', () => {
  assert.deepEqual(cardText({ k: 'aabbccddeeff', l: { kind: 'conversation', day: '2026-11-01', title: 'A talk  about\nlights' } }), { head: 'CONVERSATION · 2026-11-01', lines: ['A talk about lights'] })
  assert.deepEqual(cardText({ k: 'aabbccddeeff' }), { head: 'MEMORY', lines: ['#aabbccddeeff', 'words not shown'] })
  const system = cardText({ l: { kind: 'connector', title: 'Zapier' }, x: { rows: [['token', 'not saved'], ['rule', 'asks first'], ['a', 'b'], ['c', 'd']] } })
  assert.equal(system.head, 'CONNECTOR'); assert.deepEqual(system.lines, ['Zapier', 'token: not saved', 'rule: asks first', 'a: b'])
  assert.equal(cardFraction({ x: { rows: [['latest', '30/36 on 2026-11-17']] } }), 30 / 36); assert.equal(cardFraction({ x: { rows: [['state', 'ok']] } }), null)
})

test('inside her city the picture is clean and the blocks are glass', () => {
  const scene = fs.readFileSync(new URL('./crystal-scene.js', import.meta.url), 'utf8'), detail = fs.readFileSync(new URL('./city-detail.js', import.meta.url), 'utf8')
  assert.ok(scene.includes('post.mix.uniforms.uSoft.value = 0') && scene.includes('post.mix.uniforms.uDof.value = 0') && scene.includes('uGrainOn.value = 0'), 'no blur inside and no grain anywhere (grain off outside too since 2026-11-21)')
  assert.ok(detail.includes('transparent: true') && detail.includes('uAtlas') && detail.includes('function setFocus(index)'))
})
