import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { requestsInstructionSkillInstall, skillArchiveMention, openInstructionSkillInstaller } from '../bridge/skill-installer-tools.mjs'

test('only explicit local skill installation requests open review', () => {
  for (const goal of ['Install this skill.', 'Please import these skills.', 'Can you install the writing skill?'])
    assert.equal(requestsInstructionSkillInstall(goal), true, goal)
  for (const goal of ['How do I install a skill?', "Don't install the skill.", 'Explain "install this skill".', 'Install a game.'])
    assert.equal(requestsInstructionSkillInstall(goal), false, goal)
})

test('skill package selection preserves quoted Windows paths and rejects remote ambiguity', () => {
  assert.equal(skillArchiveMention('Install the skill "C:\\My Downloads\\writing.zip"'), 'C:\\My Downloads\\writing.zip')
  assert.equal(skillArchiveMention('Install a skill'), null)
  assert.throws(() => skillArchiveMention('Install a skill https://example.com/skill.zip'), /local ZIP/)
  assert.throws(() => skillArchiveMention('Install skills "C:\\a.zip" "C:\\b.zip"'), /one local/)
})

test('chat opens the owned desktop review with literal argv and never reports installed', async t => {
  const root = mkdtempSync(join(tmpdir(), 'nori-skill-opener-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const executable = join(root, 'Nori.exe')
  writeFileSync(executable, 'fixture')
  let call
  const receipt = await openInstructionSkillInstaller('Install the skill "C:\\My Downloads\\writing.zip"', {
    environment: { NORI_SKILL_DESKTOP_EXECUTABLE: executable },
    runFile: (exe, args, options, callback) => { call = { exe, args, options }; callback(null) },
  })
  assert.deepEqual(call.args, ['--nori-install-skill', 'C:\\My Downloads\\writing.zip', '--nori-skill-direct'])
  assert.equal(receipt.outcome, 'install_started')
  assert.equal(call.options.shell, false)
  assert.equal(receipt.installed, false)
  assert.equal(receipt.packageCodeExecuted, false)
})

test('missing desktop connection is an explicit failure', async () => {
  await assert.rejects(openInstructionSkillInstaller('Install a skill.', { environment: {} }), /not connected/)
})

test('a chat install with no package named still opens the picker, not a direct install', async t => {
  const root = mkdtempSync(join(tmpdir(), 'nori-skill-opener-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const executable = join(root, 'Nori.exe')
  writeFileSync(executable, 'fixture')
  let call
  const receipt = await openInstructionSkillInstaller('Install a skill.', {
    environment: { NORI_SKILL_DESKTOP_EXECUTABLE: executable },
    runFile: (exe, args, options, callback) => { call = { exe, args }; callback(null) },
  })
  assert.deepEqual(call.args, ['--nori-install-skill'])
  assert.equal(receipt.outcome, 'review_opened')
})
