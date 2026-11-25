import test from 'node:test'
import assert from 'node:assert/strict'
import { isAiderCodeRequest } from '../bridge/aider-tools.mjs'
import { requestsInstalledSkillCatalog } from '../bridge/skill-catalog-status.mjs'

test('skill execution metadata does not request a coding worker', () => {
  for (const text of [
    'List your verified installed instruction skills. Confirm whether code-reviewer is installed, its integrity status, and whether it can execute package code. This is a read-only skill-catalog acceptance check; do not install anything or change files.',
    'List your installed skills. Say whether this skill can execute bundled code. Do not run anything.',
  ]) {
    assert.equal(requestsInstalledSkillCatalog(text), true)
    assert.equal(isAiderCodeRequest(text), false)
  }
})

test('a catalog request cannot swallow an independent coding action', () => {
  for (const text of [
    'List your installed skills; now fix the code in calculator.py.',
    'List your installed skills, then please use Aider to fix the bug.',
  ]) {
    assert.equal(requestsInstalledSkillCatalog(text), false)
    assert.equal(isAiderCodeRequest(text), true)
  }
})
