import test from 'node:test'
import assert from 'node:assert/strict'
import { requestsInstructionSkillAuthoring, skillAuthoringAnswer } from '../bridge/skill-authoring-tools.mjs'
import { requestsInstructionSkillInstall } from '../bridge/skill-installer-tools.mjs'
import { AIDER_TASK_CONTRACT, isAiderCodeRequest } from '../bridge/aider-tools.mjs'

test('coding requests use the bounded Aider route while capability questions do not', () => {
  assert.equal(isAiderCodeRequest('Fix the parser source code in the repository'), true)
  assert.equal(isAiderCodeRequest('What coding tools do you have?'), false)
  assert.equal(AIDER_TASK_CONTRACT, 'nori.aider.coding-task.v1')
})

test('skill creation is a distinct draft-only intent', () => {
  assert.equal(requestsInstructionSkillAuthoring('Create a skill for reviewing release notes'), true)
  assert.equal(requestsInstructionSkillInstall('Create a skill for reviewing release notes'), false)
  assert.match(skillAuthoringAnswer('Create a skill for reviewing release notes'), /draft-only/i)
  assert.match(skillAuthoringAnswer('Create a skill for reviewing release notes'), /will not install/i)
})

test('skill ZIP installation remains the explicit separate route', () => {
  assert.equal(requestsInstructionSkillInstall('Install this skill ZIP: C:\\Temp\\review.zip'), true)
  assert.equal(requestsInstructionSkillAuthoring('Install this skill ZIP: C:\\Temp\\review.zip'), false)
})
