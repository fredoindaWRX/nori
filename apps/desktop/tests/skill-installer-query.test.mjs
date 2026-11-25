import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

test('native chat opens skill review without a model call and recovers after an installer failure', async t => {
  const root = mkdtempSync(join(tmpdir(), 'nori-skill-query-'))
  const keys = ['NORI_INFERENCE_RUNTIME', 'NORI_SETTINGS_DIR', 'NORI_LEARNING_FILE']
  const saved = keys.map(key => process.env[key])
  process.env.NORI_INFERENCE_RUNTIME = 'norllama'
  process.env.NORI_SETTINGS_DIR = root
  process.env.NORI_LEARNING_FILE = join(root, 'learning.json')
  t.after(() => {
    keys.forEach((key, i) => { if (saved[i] === undefined) delete process.env[key]; else process.env[key] = saved[i] })
    rmSync(root, { recursive: true, force: true })
  })
  const { query } = await import('../bridge/nori-v2-query.mjs?skill-installer-query')
  async function* prompt() {
    yield { message: { content: 'Install this writing skill "C:\\Downloads\\writing.zip"' } }
    yield { message: { content: 'Install this instruction package.' } }
    yield { message: { content: 'Turn the interface ghost purple.' } }
  }
  let calls = 0
  const results = []
  for await (const event of query({ prompt: prompt(), options: {
    openInstructionSkillInstaller: async goal => {
      calls++
      if (calls === 1) throw new Error('Installer fixture unavailable')
      assert.match(goal, /instruction package/)
      return { outcome: 'review_opened', installed: false, message: 'Review opened. No installation is confirmed yet.' }
    }, nativeUi: () => {},
  } })) if (event.type === 'result') results.push(event)
  assert.equal(calls, 2)
  assert.equal(results[0].error_code, 'NORI_LOCAL_SKILL_INSTALLER_FAILED')
  assert.equal(results[1].subtype, 'success')
  assert.match(results[1].result, /No installation is confirmed/)
  assert.equal(results[2].result, 'Done.')
})
