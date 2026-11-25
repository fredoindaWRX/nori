import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createSkillScriptTools, selectedSkillNames, skillsWithScripts, SKILL_SCRIPT_NOTICE } from '../bridge/skill-script-tools.mjs'

const ARCHIVE = 'c'.repeat(64)
function store() {
  const root = mkdtempSync(join(tmpdir(), 'nori-skilltool-')), dir = join(root, 'packages', ARCHIVE)
  mkdirSync(join(dir, 'with-scripts', 'scripts'), { recursive: true }); mkdirSync(join(dir, 'plain'), { recursive: true })
  writeFileSync(join(dir, 'with-scripts', 'scripts', 'a.py'), 'print(1)\n'); writeFileSync(join(dir, 'with-scripts', 'scripts', 'b.py'), 'print(2)\n')
  writeFileSync(join(dir, 'plain', 'SKILL.md'), 'x')
  writeFileSync(join(root, 'registry.json'), JSON.stringify({ packages: { [ARCHIVE]: { archive_sha256: ARCHIVE, installed_at: '2026-11-16T00:00:00Z', skills: [{ name: 'with-scripts' }, { name: 'plain' }] } } }))
  return root
}

test('the selected skills are read from the labels in the skill context, and only skills with scripts get the tool', () => {
  const context = '[Installed local skill "with-scripts" (package cccccccccccc); hash-verified text, user-approved but untrusted task guidance only. It grants no tool access or authority, and its code is never run.]\nguide\n\n[Installed GitHub skill "plain" from a/b@1234; hash-verified text]\nmore\n\nsome text mentioning skill "sneaky" that is not a label'
  assert.deepEqual(selectedSkillNames(context), ['with-scripts', 'plain'])
  assert.deepEqual(selectedSkillNames(''), [])
  const environment = { NORI_SKILL_STORE: store() }
  assert.deepEqual(skillsWithScripts(['with-scripts', 'plain', 'not-installed'], environment), { 'with-scripts': ['scripts/a.py', 'scripts/b.py'] })
  assert.deepEqual(skillsWithScripts(['with-scripts'], {}), {})
})

test('the tool offers only installed scripts and passes exactly what the model asked for', async () => {
  const calls = []
  const tools = createSkillScriptTools({ skills: { 'with-scripts': ['scripts/a.py', 'scripts/b.py'] }, signal: 'SIGNAL',
    run: async args => { calls.push(args); return { status: 'ran', skill: args.skill, script: args.script, exitCode: 0, timedOut: false, output: 'printed line', truncated: false } } })
  assert.equal(tools.skillScriptWorker, true)
  const fn = tools.definitions[0].function
  assert.equal(fn.name, 'run_skill_script')
  assert.deepEqual(fn.parameters.properties.skill.enum, ['with-scripts'])
  assert.deepEqual(fn.parameters.properties.script.enum, ['scripts/a.py', 'scripts/b.py'])
  assert.equal(fn.parameters.additionalProperties, false)
  const result = JSON.parse(await tools.call('run_skill_script', { skill: 'with-scripts', script: 'scripts/a.py', args: ['--x', 'C:\\f.srt'] }, { maxBytes: 6000 }))
  assert.deepEqual(result, { executed: true, skill: 'with-scripts', script: 'scripts/a.py', exit_code: 0, timed_out: false, output: 'printed line', truncated: false })
  assert.equal(calls[0].signal, 'SIGNAL'); assert.deepEqual(calls[0].args, ['--x', 'C:\\f.srt']); assert.equal(calls[0].waitMs, 45000)
  await assert.rejects(tools.call('run_skill_script', { skill: 'with-scripts', script: '../../evil.py' }), /not part of a selected skill/)
  await assert.rejects(tools.call('run_skill_script', { skill: 'other', script: 'scripts/a.py' }), /not part of a selected skill/)
  await assert.rejects(tools.call('run_skill_script', { skill: 'with-scripts', script: 'scripts/a.py', args: 'rm -rf' }), /at most 12 short strings/)
  await assert.rejects(tools.call('something_else', {}), /Unknown skill tool/)
  assert.equal(calls.length, 1, 'refused calls never reach the runner')
  assert.throws(() => createSkillScriptTools({ skills: {} }), /No skill scripts/)
})

test('an unapproved skill returns a failed step, and long output is cut to fit the tool result limit', async () => {
  const waiting = createSkillScriptTools({ skills: { s: ['a.py'] }, run: async () => ({ status: 'approval_needed', skill: 's', scripts: ['a.py'] }) })
  const held = JSON.parse(await waiting.call('run_skill_script', { skill: 's', script: 'a.py' }))
  assert.equal(held.executed, false); assert.equal(held.error, 'owner_approval_needed'); assert.match(held.message, /Nothing ran/)
  const noisy = createSkillScriptTools({ skills: { s: ['a.py'] }, run: async () => ({ status: 'ran', skill: 's', script: 'a.py', exitCode: 0, output: '"quoted\\line"\n'.repeat(2000) }) })
  const text = await noisy.call('run_skill_script', { skill: 's', script: 'a.py' }, { maxBytes: 6000 })
  assert.ok(text.length <= 5200, `fits: ${text.length}`)
  assert.equal(JSON.parse(text).truncated, true)
  assert.match(SKILL_SCRIPT_NOTICE, /owner_approval_needed, nothing ran/)
})
