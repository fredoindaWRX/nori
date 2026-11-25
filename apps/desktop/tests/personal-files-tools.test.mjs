import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { copyFile, readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createPersonalFilesTools } from '../bridge/personal-files-tools.mjs'

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'nori-personal-files-'))
  mkdirSync(join(root, 'Documents', 'notes'), { recursive: true })
  mkdirSync(join(root, 'Documents', 'AppData'), { recursive: true })
  writeFileSync(join(root, 'Documents', 'notes', 'journal.txt'), 'first\nsecond needle\nthird NEEDLE\nfourth\n')
  writeFileSync(join(root, 'Documents', 'notes', 'secrets.txt'), 'needle must not leak')
  writeFileSync(join(root, 'Documents', 'notes', '.hidden.txt'), 'needle hidden')
  writeFileSync(join(root, 'Documents', 'AppData', 'private.txt'), 'needle skipped')
  writeFileSync(join(root, 'Documents', 'notes', 'binary.txt'), Buffer.from([0, 1, 2]))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  return createPersonalFilesTools({ roots: new Map([['Documents', join(root, 'Documents')]]) })
}

function hash(value) { return createHash('sha256').update(value).digest('hex') }

test('personal file reader supports bounded line paging', async t => {
  const tools = fixture(t)
  const first = JSON.parse(await tools.call('read_my_file', { file: 'Documents/notes/journal.txt', line_count: 2 }))
  assert.equal(first.start_line, 1)
  assert.equal(first.returned_lines, 2)
  assert.equal(first.content, 'first\nsecond needle')
  assert.equal(first.next_start_line, 3)
  const next = JSON.parse(await tools.call('read_my_file', { file: 'Documents/notes/journal.txt', start_line: first.next_start_line, line_count: 2 }))
  assert.equal(next.content, 'third NEEDLE\nfourth')
  assert.equal(next.next_start_line, undefined)
})

test('personal file content search is literal, case-insensitive, and excludes hidden, skipped, secret and binary files', async t => {
  const tools = fixture(t)
  const result = JSON.parse(await tools.call('search_my_file_contents', { query: 'needle', folder: 'Documents' }))
  assert.deepEqual(result.matches.map(item => [item.file, item.line]), [
    ['Documents/notes/journal.txt', 2], ['Documents/notes/journal.txt', 3],
  ])
  assert.equal(result.scanned_entries, 6)
})

test('personal file access rejects traversal, skipped roots, hidden paths and invalid pages', async t => {
  const tools = fixture(t)
  await assert.rejects(tools.call('read_my_file', { file: 'Documents/../outside.txt' }), /not allowed/)
  await assert.rejects(tools.call('read_my_file', { file: 'Documents/AppData/private.txt' }), /not allowed/)
  await assert.rejects(tools.call('read_my_file', { file: 'Documents/notes/.hidden.txt' }), /not allowed/)
  await assert.rejects(tools.call('read_my_file', { file: 'Documents/notes/journal.txt', start_line: 0 }), /start_line/)
  await assert.rejects(tools.call('read_my_file', { file: 'Documents/notes/journal.txt', line_count: 201 }), /line_count/)
  await assert.rejects(tools.call('search_my_file_contents', { query: ' ' }), /search phrase/)
})

test('writes are absent by default and existing-file replacement requires a verified pre-write backup', async t => {
  const readOnly = fixture(t)
  assert.equal(readOnly.definitions.some(tool => ['write_my_file', 'edit_my_file_exactly'].includes(tool.function.name)), false)
  await assert.rejects(readOnly.call('write_my_file', { file: 'Documents/notes/new.txt', content: 'x' }), /disabled/)

  const root = mkdtempSync(join(tmpdir(), 'nori-personal-write-'))
  const documents = join(root, 'Documents')
  mkdirSync(join(documents, 'notes'), { recursive: true })
  const target = join(documents, 'notes', 'note.txt')
  writeFileSync(target, 'alpha\nbeta\n')
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const backupDir = join(root, 'backup')
  mkdirSync(backupDir)
  const events = []
  const tools = createPersonalFilesTools({ roots: new Map([['Documents', documents]]), writeEnabled: true,
    backupBeforeWrite: async path => {
      const original = await readFile(path)
      const backupPath = join(backupDir, 'note.txt.bak')
      await copyFile(path, backupPath)
      events.push('backup')
      return { verified: true, targetSha256: hash(original), backupSha256: hash(await readFile(backupPath)), backupPath }
    } })
  const result = JSON.parse(await tools.call('write_my_file', { file: 'Documents/notes/note.txt', content: 'replacement\n' }))
  events.push('write-returned')
  assert.deepEqual(events, ['backup', 'write-returned'])
  assert.equal(result.created, false)
  assert.equal(await readFile(target, 'utf8'), 'replacement\n')
  assert.equal(await readFile(join(backupDir, 'note.txt.bak'), 'utf8'), 'alpha\nbeta\n')
})

test('exact edits require exactly one match and refuse when the backup receipt is invalid', async t => {
  const root = mkdtempSync(join(tmpdir(), 'nori-personal-edit-'))
  const documents = join(root, 'Documents')
  mkdirSync(documents)
  const target = join(documents, 'note.txt')
  writeFileSync(target, 'before token after\n')
  t.after(() => rmSync(root, { recursive: true, force: true }))
  let calls = 0
  const tools = createPersonalFilesTools({ roots: new Map([['Documents', documents]]), writeEnabled: true,
    backupBeforeWrite: async () => { calls++; return { verified: false } } })
  await assert.rejects(tools.call('edit_my_file_exactly', { file: 'Documents/note.txt', find: 'missing', replace: 'x' }), /exactly once/)
  assert.equal(calls, 0)
  await assert.rejects(tools.call('edit_my_file_exactly', { file: 'Documents/note.txt', find: 'token', replace: 'secret' }), /not verified in a separate backup/)
  assert.equal(calls, 1)
  assert.equal(await readFile(target, 'utf8'), 'before token after\n')
  assert.equal(tools.definitions.some(tool => tool.function.name.includes('delete')), false)
})

test('a file changed during backup is not overwritten', async t => {
  const root = mkdtempSync(join(tmpdir(), 'nori-personal-race-'))
  const documents = join(root, 'Documents')
  mkdirSync(documents)
  const target = join(documents, 'note.txt')
  writeFileSync(target, 'original\n')
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const backupPath = join(root, 'note.backup')
  const tools = createPersonalFilesTools({ roots: new Map([['Documents', documents]]), writeEnabled: true,
    backupBeforeWrite: async path => {
      const before = await readFile(path)
      await copyFile(path, backupPath)
      writeFileSync(path, 'changed by another writer\n')
      return { verified: true, targetSha256: hash(before), backupSha256: hash(await readFile(backupPath)), backupPath }
    } })
  await assert.rejects(tools.call('write_my_file', { file: 'Documents/note.txt', content: 'unsafe replacement' }), /changed while its backup/)
  assert.equal(await readFile(target, 'utf8'), 'changed by another writer\n')
})
