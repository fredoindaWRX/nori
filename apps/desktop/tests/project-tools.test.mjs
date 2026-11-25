import test from 'node:test'
import assert from 'node:assert/strict'
import { linkSync, mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createNoriProjectTools } from '../bridge/project-tools.mjs'

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'nori-project-tools-'))
  mkdirSync(join(root, 'docs'))
  mkdirSync(join(root, 'skills', 'incoming', 'reference', 'demo'), { recursive: true })
  mkdirSync(join(root, 'skills', 'quarantine', 'held'), { recursive: true })
  mkdirSync(join(root, 'skills', 'nori-owned-candidate'), { recursive: true })
  mkdirSync(join(root, 'models'))
  writeFileSync(join(root, 'README.md'), 'Nori project fixture\nsecond line\n')
  writeFileSync(join(root, 'docs', 'guide.txt'), 'alpha\nbeta\ngamma\n')
  writeFileSync(join(root, '.env'), 'TOKEN=do-not-read\n')
  writeFileSync(join(root, 'models', 'weights.bin'), Buffer.from([0, 1, 2, 3]))
  writeFileSync(join(root, 'skills', 'incoming', 'reference', 'demo', 'SKILL.md'), 'untrusted reference')
  writeFileSync(join(root, 'skills', 'quarantine', 'held', 'skill.json'), '{}')
  writeFileSync(join(root, 'skills', 'nori-owned-candidate', 'skill.py'), 'def run(): pass')
  t.after(() => rmSync(root, { recursive: true, force: true }))
  return { root, tools: createNoriProjectTools(root) }
}

test('Nori project reader lists and reads bounded UTF-8 files under its root', async t => {
  const { tools } = fixture(t)
  const listing = JSON.parse(await tools.call('list_dir', { path: '.' }))
  assert.deepEqual(listing.entries.map(entry => entry.name), ['docs', 'README.md', 'skills'])
  const excerpt = JSON.parse(await tools.call('read_file', { path: 'docs/guide.txt', start_line: 2, max_lines: 1 }))
  assert.deepEqual(excerpt, { path: 'docs/guide.txt', start_line: 2, returned_lines: 1, content: 'beta', omitted: true })
})

test('Nori skill catalog lists bounded artifacts with non-authoritative lifecycle classifications', async t => {
  const { tools } = fixture(t)
  const result = JSON.parse(await tools.call('list_skill_catalog', { path: 'skills' }))
  assert.equal(result.root, 'skills')
  assert.equal(result.installedTotal, null)
  assert.deepEqual(result.entries, [
    { path: 'skills/incoming/reference/demo/SKILL.md', source: 'bundled', classification: 'incoming_reference', activation: 'not_asserted' },
    { path: 'skills/nori-owned-candidate/skill.py', source: 'bundled', classification: 'local_candidate_artifact', activation: 'not_asserted' },
    { path: 'skills/quarantine/held/skill.json', source: 'bundled', classification: 'quarantined', activation: 'not_asserted' },
  ])
  assert.equal(result.truncated, false)
  await assert.rejects(tools.call('list_skill_catalog', { path: '.' }), /literal skills path/)
  await assert.rejects(tools.call('list_skill_catalog', { path: 'skills', extra: true }), /literal skills path/)
  assert.ok(Buffer.byteLength(await tools.call('list_skill_catalog', { path: 'skills' }, { maxBytes: 256 }), 'utf8') <= 256)
})

test('Nori project reader rejects traversal, absolute, secret, generated, and binary paths', async t => {
  const { tools } = fixture(t)
  await assert.rejects(tools.call('read_file', { path: '../outside.txt' }), /not available|escaped/i)
  await assert.rejects(tools.call('read_file', { path: '.env' }), /not available|secret/i)
  await assert.rejects(tools.call('read_file', { path: 'models/weights.bin' }), /not available/i)
  await assert.rejects(tools.call('list_dir', { path: 'models' }), /not available/i)
  await assert.rejects(tools.call('read_file', { path: 'C:\\Windows\\win.ini' }), /project-relative|Absolute paths/i)
  await assert.rejects(tools.call('read_file', { path: 'README.md', extra: true }), /only path/)
})

test('Nori project reader keeps excerpts within caller byte cap', async t => {
  const { root, tools } = fixture(t)
  writeFileSync(join(root, 'docs', 'long.txt'), `${'abcdefghij'.repeat(100)}\n`)
  const result = await tools.call('read_file', { path: 'docs/long.txt' }, { maxBytes: 300 })
  assert.ok(Buffer.byteLength(result, 'utf8') <= 300)
  assert.equal(JSON.parse(result).omitted, true)
})

test('Nori project reader can return a larger evidence excerpt when the caller has context room', async t => {
  const { root } = fixture(t)
  const tools = createNoriProjectTools(root, { maxResultBytes: 8192 })
  const evidence = 'bounded evidence line '.repeat(250)
  writeFileSync(join(root, 'docs', 'long.txt'), `${evidence}\n`)
  const result = await tools.call('read_file', { path: 'docs/long.txt', max_lines: 1 }, { maxBytes: 7000 })
  assert.ok(Buffer.byteLength(result, 'utf8') > 2400)
  assert.ok(Buffer.byteLength(result, 'utf8') <= 7000)
  assert.equal(JSON.parse(result).content, evidence)
})

test('Nori project reader refuses multiply-linked files and symbolic links', async t => {
  const { root, tools } = fixture(t)
  linkSync(join(root, 'docs', 'guide.txt'), join(root, 'docs', 'linked.txt'))
  await assert.rejects(tools.call('read_file', { path: 'docs/linked.txt' }), /multiply-linked/)
  try { symlinkSync(join(root, 'docs', 'guide.txt'), join(root, 'docs', 'symbolic.txt')) }
  catch (error) {
    if (['EPERM', 'EACCES', 'ENOTSUP'].includes(error.code)) return t.skip('Windows symlink creation is unavailable in this account')
    throw error
  }
  await assert.rejects(tools.call('read_file', { path: 'docs/symbolic.txt' }), /not available|Reparse points/)
  const listing = JSON.parse(await tools.call('list_dir', { path: 'docs' }))
  assert.equal(listing.entries.some(entry => entry.name === 'symbolic.txt'), false)
})

test('attached-file edit tool creates a new scoped copy and never overwrites an existing output', async t => {
  const { root } = fixture(t)
  const original = join(root, 'docs', 'guide.txt')
  const before = readFileSync(original, 'utf8')
  const tools = createNoriProjectTools(root, { attachmentWriteEnabled: true })
  assert.ok(tools.definitions.some(entry => entry.function.name === 'save_edited_copy'))
  const receipt = JSON.parse(await tools.call('save_edited_copy', {
    filename: 'guide-edited.txt', content: 'Nori edited this local copy.\n',
  }))
  assert.deepEqual(receipt, { saved: true, path: 'user-edits/guide-edited.txt', bytes: 29, original_overwritten: false })
  assert.equal(readFileSync(original, 'utf8'), before)
  assert.equal(readFileSync(join(root, 'user-edits', 'guide-edited.txt'), 'utf8'), 'Nori edited this local copy.\n')
  await assert.rejects(tools.call('save_edited_copy', {
    filename: 'guide-edited.txt', content: 'must not overwrite',
  }), /already exists/)
  await assert.rejects(tools.call('save_edited_copy', {
    filename: '..\\outside.txt', content: 'blocked',
  }), /plain filename/)
  await assert.rejects(tools.call('save_edited_copy', {
    filename: 'document.pdf', content: 'unsupported',
  }), /text\/code files only/)
})

test('attached-file save tool is absent and rejected unless explicitly enabled for that request', async t => {
  const { tools } = fixture(t)
  assert.equal(tools.definitions.some(entry => entry.function.name === 'save_edited_copy'), false)
  await assert.rejects(tools.call('save_edited_copy', {
    filename: 'blocked.txt', content: 'not enabled',
  }), /no such registered tool/)
})

