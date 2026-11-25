import test from 'node:test'
import assert from 'node:assert/strict'
import { requestsInstalledSkillCatalog } from '../bridge/skill-catalog-status.mjs'

test('negated catalog display requests do not trigger a registry read', () => {
  for (const goal of [
    'Do not show your skill catalog.',
    "Don't show my installed skills.",
    'Don’t show my installed skills.',
    'Never list your installed skills.',
    "Don't tell me your installed skills.",
    'Do not ever display your skill registry.',
    'Explain the feature without showing your installed skills.',
    'Do not read personal files and your skill catalog.',
    'Do not use tools to list your installed skills.',
    'Do not read my personal files. My skill catalog exists.',
  ]) assert.equal(requestsInstalledSkillCatalog(goal), false, goal)
})

test('catalog reads do not swallow independent project/file reads', () => {
  for (const goal of [
    'List your installed skills, then read calculator.py in the selected project.',
    'Show your skill catalog. Review calculator.py.',
    'Inspect C:\\Nori\\apps\\desktop and list your installed skills.',
    'Review your project source code and tell me your skill catalog.',
    'List your installed skills. Could you read calculator.py?',
    'List your installed skills, and could you please read calculator.py?',
    'List your installed skills, then read "calculator.py".',
    'List your installed skills without reading unrelated files, but read calculator.py.',
  ]) assert.equal(requestsInstalledSkillCatalog(goal), false, goal)
})

test('catalog reads do not swallow other explicit actions or searches', () => {
  for (const goal of [
    'List your installed skills, then search the web for local news.',
    'Show your skill catalog and browse https://example.test/.',
    'Show your skill catalog. Open the selected project.',
    'List your installed skills and edit calculator.py.',
    'Download a skill reference and show your skill catalog.',
  ]) assert.equal(requestsInstalledSkillCatalog(goal), false, goal)
})

test('ordinary catalog metadata queries and no-mutation constraints still work', () => {
  for (const goal of [
    'Read your verified skill catalog.',
    'Could you please read your verified skill catalog?',
    'Show your installed skills and their descriptions.',
    'Tell me what skills are installed and explain their purpose.',
    'Check your verified local skill catalog and report its names. Do not install anything or edit files.',
    "Show your skill catalog. Don't execute code.",
    'Show your skill catalog. Don’t execute code.',
    'Do not edit files. List your installed skills.',
    'Do you like the new packages I installed for you?',
    'List your installed skills that can read files.',
    'What skills do you have installed to edit prose?',
    'Check your catalog and tell me which skills can inspect code.',
    'List your installed skills without reading unrelated files',
    'Show your skill catalog. Do not read my personal files.',
    'Do not read my personal files. List your installed skills.',
    'Check your skill catalog without reading unrelated files.',
    'Do not read other files and show your skill catalog.',
  ]) assert.equal(requestsInstalledSkillCatalog(goal), true, goal)
})

test('an instruction catalog request does not imply visibility into all system packages', () => {
  for (const goal of [
    'What packages have you installed for yourself?',
    'List pip packages.',
    'What npm packages are installed?',
    'Show every installed Windows package.',
  ]) assert.equal(requestsInstalledSkillCatalog(goal), false, goal)
})
