const test = require('node:test')
const assert = require('node:assert/strict')
const { mkdtempSync, mkdirSync, writeFileSync, rmSync } = require('node:fs')
const { join } = require('node:path')
const { tmpdir } = require('node:os')
const { createSkillInstaller } = require('../desktop/skill-installer.cjs')

function fixture(t, { approve = true, corruptReceipt = false, corruptCatalog = false } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'nori-skill-host-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  mkdirSync(join(root, 'python/Python311'), { recursive: true })
  mkdirSync(join(root, 'nori'))
  writeFileSync(join(root, 'python/Python311/python.exe'), 'trusted worker fixture')
  writeFileSync(join(root, 'nori/local_skill_installer.py'), 'trusted entry fixture')
  const archive = join(root, 'skill.zip')
  writeFileSync(archive, 'not executed by this host fixture')
  const calls = [], dialogs = []
  const skill = { name: 'plain-writing', description: 'Plain writing', code_execution_enabled: false }
  const dialog = {
    showOpenDialog: async () => ({ canceled: false, filePaths: [archive] }),
    showMessageBox: async options => { dialogs.push(options); return { response: approve ? 1 : 0 } },
  }
  const runFile = (executable, args, options, callback) => {
    calls.push({ executable, args, options })
    const result = args[2] === 'inspect'
      ? { schema: 'nori.local-skill-plan.v1', plan_sha256: 'a'.repeat(64), skills: [skill] }
      : args[2] === 'list'
        ? { schema: 'nori.instruction-skill-catalog.v1', verified: !corruptCatalog,
          skills: [{ ...skill, mode: 'instruction_reference' }] }
        : { installed: true, code_executed: false, skills: corruptReceipt ? ['different-skill'] : ['plain-writing'] }
    callback(null, JSON.stringify(result), '')
  }
  return { host: createSkillInstaller({ suiteRoot: root, dataRoot: join(root, 'profile'), dialog, runFile }), calls, dialogs, archive }
}

test('native skill host waits for review and binds installation to the preview digest', async t => {
  const f = fixture(t)
  const result = await f.host.install(f.archive)
  assert.equal(result.outcome, 'installed')
  assert.equal(f.calls.length, 3)
  assert.equal(f.calls[2].args[2], 'list')
  assert.equal(result.post_install_verified, true)
  assert.equal(result.live_task_tested, false)
  assert.deepEqual(f.calls[0].args.slice(0, 3), ['-I', f.calls[0].args[1], 'inspect'])
  assert.equal(f.calls[0].options.shell, false)
  assert.equal(f.calls[1].args.at(-1), 'a'.repeat(64))
  assert.match(f.dialogs[0].detail, /Bundled scripts are copied but never run/)
  assert.equal(f.dialogs[0].defaultId, 0)
})

test('installation cannot report verified success when catalog reload fails', async t => {
  const f = fixture(t, { corruptCatalog: true })
  await assert.rejects(f.host.install(f.archive), /installed, but.*reloaded and verified/)
  assert.equal(f.dialogs.length, 1)
})

test('canceling skill review never invokes installation', async t => {
  const f = fixture(t, { approve: false })
  assert.deepEqual(await f.host.install(f.archive), { outcome: 'cancelled', installed: false })
  assert.equal(f.calls.length, 1)
})

test('a mismatched worker receipt cannot be reported as the reviewed installation', async t => {
  const f = fixture(t, { corruptReceipt: true })
  await assert.rejects(f.host.install(f.archive), /did not confirm the reviewed skill set/)
  assert.equal(f.dialogs.length, 1)
})

test('non-ZIP inputs never reach the worker', async t => {
  const f = fixture(t)
  await assert.rejects(f.host.install(join(f.archive, '..', 'script.exe')), /one local ZIP/)
  assert.equal(f.calls.length, 0)
})

test('a direct install (owner named it in chat) shows no window but still inspects, installs and verifies', async t => {
  const f = fixture(t)
  const result = await f.host.install(f.archive, { direct: true })
  assert.equal(result.outcome, 'installed')
  assert.equal(result.review, 'skipped_owner_request')
  assert.equal(f.dialogs.length, 0)
  assert.deepEqual(f.calls.map(c => c.args[2]), ['inspect', 'install', 'list'])
  assert.equal(f.calls[1].args.at(-1), 'a'.repeat(64))
})

test('a direct install still refuses a package the installer does not confirm', async t => {
  const f = fixture(t, { corruptReceipt: true })
  await assert.rejects(f.host.install(f.archive, { direct: true }), /did not confirm/)
  assert.equal(f.dialogs.length, 0)
})

test('a direct install needs a named package; it never installs from an empty request', async t => {
  const f = fixture(t)
  await assert.rejects(f.host.install(undefined, { direct: true }), /needs one ZIP path/)
  assert.equal(f.calls.length, 0)
})
