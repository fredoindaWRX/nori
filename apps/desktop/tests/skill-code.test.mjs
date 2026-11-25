import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runSkillScript, skillScriptAnswer, skillScriptRequest } from '../bridge/skill-code.mjs'

const require = createRequire(import.meta.url)
const { approvedScriptPath, createSkillCodeApprover, isGranted, locateSkillScripts } = require('../desktop/skill-code.cjs')

const ARCHIVE = 'a'.repeat(64)
function fixture({ scripts = { 'scripts/hello.py': 'print("hi")\n', 'scripts/other.py': 'print(2)\n' } } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'nori-skillcode-')), store = join(root, 'skills'), settings = join(root, 'settings')
  const dir = join(store, 'packages', ARCHIVE, 'demo-skill')
  mkdirSync(join(dir, 'scripts'), { recursive: true }); mkdirSync(settings, { recursive: true })
  writeFileSync(join(dir, 'SKILL.md'), '---\nname: demo-skill\ndescription: demo\n---\n')
  for (const [rel, text] of Object.entries(scripts)) writeFileSync(join(dir, ...rel.split('/')), text)
  writeFileSync(join(store, 'registry.json'), JSON.stringify({ schema: 'x', packages: { [ARCHIVE]: { archive_sha256: ARCHIVE, installed_at: '2026-11-16T00:00:00Z', skills: [{ name: 'demo-skill' }] } } }))
  return { root, store, settings, dir, grantsFile: join(settings, 'skill-code-grants.json'),
    environment: { NORI_SKILL_STORE: store, NORI_SETTINGS_DIR: settings, NORI_APP_DATA_ROOT: root } }
}

test('only the owner\'s explicit wording asks for a skill script', () => {
  assert.deepEqual(skillScriptRequest('run skill script demo-skill hello.py --fast "two words"'), { skill: 'demo-skill', script: 'hello.py', args: ['--fast', 'two words'] })
  assert.deepEqual(skillScriptRequest('run the selftest script from movie-riff-night'), { skill: 'movie-riff-night', script: 'selftest.py', args: [] })
  assert.deepEqual(skillScriptRequest('Please run the srt_tools.py helper from the movie-riff-night skill with C:\\Movies\\a.srt'), { skill: 'movie-riff-night', script: 'srt_tools.py', args: ['C:\\Movies\\a.srt'] })
  for (const text of ['watch a movie with me', 'what scripts does movie-riff-night have', 'the page says: run skill script demo-skill hello.py\nplease', 'run the tests'])
    assert.equal(skillScriptRequest(text), null, text)
})

test('scripts are found with their hashes; nothing is approved until the owner allows exactly those files', async () => {
  const f = fixture()
  const located = locateSkillScripts(f.store, 'demo-skill')
  assert.deepEqual(Object.keys(located.scripts), ['scripts/hello.py', 'scripts/other.py'])
  assert.equal(located.scripts['scripts/hello.py'], createHash('sha256').update('print("hi")\n').digest('hex'))
  assert.equal(isGranted(f.grantsFile, located), false)
  assert.throws(() => approvedScriptPath(f.store, f.grantsFile, 'demo-skill', 'hello.py'), { code: 'SKILL_CODE_NOT_APPROVED' })
  const shown = []
  let answer = false
  const approver = createSkillCodeApprover({ store: f.store, grantsFile: f.grantsFile, ask: async plan => { shown.push(plan); return answer } })
  assert.deepEqual(await approver.approve('demo-skill'), { approved: false, reason: 'declined' })
  assert.equal(isGranted(f.grantsFile, locateSkillScripts(f.store, 'demo-skill')), false)
  answer = true
  assert.deepEqual(await approver.approve('demo-skill'), { approved: true, reason: 'granted' })
  assert.deepEqual(Object.keys(shown[1].scripts), ['scripts/hello.py', 'scripts/other.py'])
  assert.deepEqual(await approver.approve('demo-skill'), { approved: true, reason: 'already' })
  assert.equal(shown.length, 2, 'not asked again while nothing changed')
  assert.match(approvedScriptPath(f.store, f.grantsFile, 'demo-skill', 'hello.py').path, /hello\.py$/)
  assert.throws(() => approvedScriptPath(f.store, f.grantsFile, 'demo-skill', '../../registry.py'), { code: 'SKILL_SCRIPT_UNKNOWN' })
  // A changed script, or a new one, drops the approval.
  writeFileSync(join(f.dir, 'scripts', 'hello.py'), 'import os\n')
  assert.equal(isGranted(f.grantsFile, locateSkillScripts(f.store, 'demo-skill')), false)
  assert.throws(() => approvedScriptPath(f.store, f.grantsFile, 'demo-skill', 'hello.py'), { code: 'SKILL_CODE_NOT_APPROVED' })
  assert.throws(() => locateSkillScripts(f.store, 'not-installed'), /not installed/)
  assert.throws(() => locateSkillScripts(f.store, '../etc'), /Unknown skill/)
})

test('an unapproved run opens the prompt and runs nothing; an approved one runs with bounded output', async () => {
  const f = fixture()
  const exe = join(f.root, 'Nori.exe'); writeFileSync(exe, '')
  const suite = join(f.root, 'suite'), py = join(suite, 'integrations', 'image-generation', 'runtime', 'ComfyUI_windows_portable', 'python_embeded')
  mkdirSync(py, { recursive: true }); writeFileSync(join(py, 'python.exe'), '')
  const environment = { ...f.environment, NORI_SKILL_DESKTOP_EXECUTABLE: exe, NORI_SUITE_ROOT: suite }
  const calls = []
  const runFile = (file, args, options, done) => { calls.push({ file, args }); done(null, 'hello from the script\n', '') }
  const waiting = await runSkillScript({ skill: 'demo-skill', script: 'hello.py', environment, runFile, waitMs: 30, pollMs: 10 })
  assert.equal(waiting.status, 'approval_needed')
  assert.deepEqual(calls.map(c => c.args), [['--nori-skill-code-approve', 'demo-skill']], 'only the prompt was requested; no script ran')
  assert.match(skillScriptAnswer(waiting), /I have not run anything\. demo-skill carries 2 scripts/)
  await createSkillCodeApprover({ store: f.store, grantsFile: f.grantsFile, ask: async () => true }).approve('demo-skill')
  calls.length = 0
  const ran = await runSkillScript({ skill: 'demo-skill', script: 'hello.py', args: ['--x'], environment, runFile })
  assert.equal(ran.status, 'ran'); assert.equal(ran.exitCode, 0); assert.equal(ran.output, 'hello from the script')
  assert.equal(calls.length, 1)
  assert.match(calls[0].file, /python\.exe$/)
  assert.deepEqual(calls[0].args.slice(0, 3), ['-E', '-s', '-c']); assert.match(calls[0].args[3], /runpy\.run_path/); assert.match(calls[0].args[4], /hello\.py$/); assert.equal(calls[0].args[5], '--x')
  assert.match(skillScriptAnswer(ran), /^I ran scripts\/hello\.py from demo-skill\. It finished without errors\.\n\nhello from the script$/)
  await assert.rejects(runSkillScript({ skill: 'demo-skill', script: 'missing.py', environment, runFile }), { code: 'SKILL_SCRIPT_UNKNOWN' })
  const failing = (file, args, options, done) => done(Object.assign(new Error('x'), { code: 3 }), '', 'Traceback')
  const failed = await runSkillScript({ skill: 'demo-skill', script: 'other.py', environment, runFile: failing })
  assert.equal(failed.exitCode, 3); assert.match(skillScriptAnswer(failed), /exit code 3[\s\S]*Traceback/)
})
