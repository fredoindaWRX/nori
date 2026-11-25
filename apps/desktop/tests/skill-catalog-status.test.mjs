import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { requestsInstalledSkillCatalog, verifiedSkillCatalogStatus, installedSkillCatalogAnswer } from '../bridge/skill-catalog-status.mjs'
import { createNoriProjectTools } from '../bridge/project-tools.mjs'
import { callThroughNeuralese } from '../bridge/neuralese-project-tools.mjs'

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'nori-catalog-status-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const digest = 'a'.repeat(64), base = join(root, 'packages', digest, 'fixture-skill')
  mkdirSync(base, { recursive: true })
  const content = '# Fixture\nUntrusted instruction reference.'
  writeFileSync(join(base, 'SKILL.md'), content)
  const registry = { schema: 'nori.instruction-skills.v1', packages: { [digest]: {
    archive_sha256: digest, source_kind: 'local_zip', skills: [{ name: 'fixture-skill',
      version: '1.2', description: 'Fixture guidance', mode: 'instruction_reference', code_execution_enabled: false,
      files: { 'SKILL.md': { sha256: createHash('sha256').update(content).digest('hex'), bytes: Buffer.byteLength(content) } },
    }],
  } } }
  const save = () => writeFileSync(join(root, 'registry.json'), JSON.stringify(registry))
  save()
  return { root, base, registry, digest, save }
}

test('bounded tool catalog retains verified installed total when entries do not fit', async t => {
  const f = fixture(t)
  const tool = createNoriProjectTools(f.root, {skillStore:f.root, maxResultBytes:256})
  const wire = await callThroughNeuralese(tool, 'list_skill_catalog', {path:'skills'}, {maxBytes:256}, 'catalog_count_test')
  const result = JSON.parse(wire)
  assert.equal(result.installedTotal, 1)
  assert.equal(result.installed, 'verified')
  assert.equal(result.entries.length, 0)
  assert.equal(result.truncated, true)
  assert.ok(Buffer.byteLength(wire) <= 256)
})

test('catalog intent is explicit, read-only, and ignores quoted instructions', () => {
  for (const goal of ['Do you like the new packages I installed for you?', 'What skills do you have installed?', 'Show your skill catalog.', 'Check your installed skills.', 'Which of your skills are available?']) {
    assert.equal(requestsInstalledSkillCatalog(goal), true, goal)
  }
  for (const goal of ['Install this skill.', 'Create a skill.', 'List pip packages.', 'What npm packages are installed?', 'Do not check your skills.', 'Explain "show your skill catalog".', 'Write a story about your skills.', 'What is a skill?']) {
    assert.equal(requestsInstalledSkillCatalog(goal), false, goal)
  }
})

test('read-only catalog constraints do not hide installed skills or swallow positive actions', () => {
  for (const goal of [
    'What instruction skills do you have installed? Check your verified local skill catalog and report its names. Do not install anything or edit files.',
    "Show your skill catalog. Don't execute code.",
    'Do not edit files. List your installed skills.',
    'List your installed instruction skills using your local skill catalog tool. Report the count and three skill names. Read only; do not install, edit, or save a memory.',
  ]) assert.equal(requestsInstalledSkillCatalog(goal), true, goal)
  for (const goal of [
    'List your skills. Install this package.',
    'List your skills. Do not install anything but run this script.',
    'Do not check your skills. Do not install anything.',
    'List your skills and install the missing ones.',
    'List your skills. Do not install, edit, or save a memory. Install this package.',
    'List your skills. Do not install, edit, or save a memory but run this script.',
    'Do not check your skills. Do not install, edit, or save a memory.',
  ]) assert.equal(requestsInstalledSkillCatalog(goal), false, goal)
})

test('catalog reports verified files and recorded provenance without granting execution', t => {
  const f = fixture(t)
  const status = verifiedSkillCatalogStatus(f.root)
  assert.equal(status.status, 'verified')
  assert.equal(status.skills[0].packageSha256, f.digest)
  assert.equal(status.skills[0].version, '1.2')
  assert.equal(status.skills[0].codeExecutionEnabled, false)
  const reply = installedSkillCatalogAnswer(f.root)
  assert.match(reply, /1 verified skill\./)
  assert.match(reply, /fixture-skill/)
  assert.match(reply, /code execution is disabled/)
  assert.match(reply, /does not inspect system pip\/npm/)
})

test('missing and tampered catalogs cannot masquerade as zero installed skills', t => {
  const f = fixture(t)
  assert.equal(verifiedSkillCatalogStatus('').status, 'unavailable')
  assert.equal(verifiedSkillCatalogStatus(join(f.root, 'absent')).status, 'unverified')
  writeFileSync(join(f.base, 'SKILL.md'), 'changed')
  assert.equal(verifiedSkillCatalogStatus(f.root).status, 'unverified')
  assert.match(installedSkillCatalogAnswer(f.root), /have not concluded that no skills are installed/)
  assert.doesNotMatch(installedSkillCatalogAnswer(f.root), /0 verified/)
})

test('a valid empty catalog is distinct from invalid or executable records', t => {
  const f = fixture(t)
  f.registry.packages[f.digest].skills[0].code_execution_enabled = true
  f.save()
  assert.equal(verifiedSkillCatalogStatus(f.root).status, 'unverified')
  f.registry.packages = {}
  f.save()
  assert.equal(verifiedSkillCatalogStatus(f.root).status, 'verified')
  assert.match(installedSkillCatalogAnswer(f.root), /0 verified skills/)
})

test('the chat entry point reads only the configured catalog without inference across runtime modes', async t => {
  const f = fixture(t)
  const keys = ['NORI_SKILL_STORE', 'NORI_SETTINGS_DIR', 'NORI_LEARNING_FILE', 'NORI_INFERENCE_RUNTIME']
  const previous = keys.map(key => process.env[key])
  Object.assign(process.env, { NORI_SKILL_STORE: f.root, NORI_SETTINGS_DIR: f.root,
    NORI_LEARNING_FILE: join(f.root, 'learning.json') })
  t.after(() => keys.forEach((key, i) => {
    if (previous[i] === undefined) delete process.env[key]
    else process.env[key] = previous[i]
  }))
  const { query } = await import('../bridge/nori-v2-query.mjs')
  const before = readFileSync(join(f.root, 'registry.json'))
  for (const mode of ['norllama', 'gpt-oss']) {
    process.env.NORI_INFERENCE_RUNTIME = mode
    async function* prompt() {
      yield { message: { content: 'What skills do you have installed?' } }
      yield { message: { content: 'Do you like the new packages I installed for you?' } }
      yield { message: { content: 'What instruction skills do you have installed? Check your verified local skill catalog and report its names. Do not install anything or edit files.' } }
      yield { message: { content: 'List your installed instruction skills using your local skill catalog tool. Report the count and three skill names. Read only; do not install, edit, or save a memory.' } }
    }
    const events = []
    for await (const event of query({ prompt: prompt(), options: {
      getModel() { assert.fail('Catalog inspection must not request a model') },
      openInstructionSkillInstaller() { assert.fail('Read-only inspection must not install') },
    } })) events.push(event)
    const result = events.find(event => event.type === 'result')
    assert.equal(result.subtype, 'success')
    assert.match(result.result, /fixture-skill/)
    assert.doesNotMatch(result.result, /can't.*access.*files/i)
    assert.equal(events.filter(event => event.type === 'result' && event.subtype === 'success').length, 4)
  }
  assert.deepEqual(readFileSync(join(f.root, 'registry.json')), before)
})
