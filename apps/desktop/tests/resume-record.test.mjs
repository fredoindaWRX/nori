import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync, symlinkSync, unlinkSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readResumeRecord, MAX_RESUME_BYTES } from '../bridge/resume-record.mjs'

test('missing resume is new state; valid legacy and native records survive', () => {
  const root = mkdtempSync(join(tmpdir(), 'nori-resume-read-')), file = join(root, 'resume.json')
  try {
    assert.equal(readResumeRecord(file), null)
    for (const record of [{ session_id: 'legacy-session' }, { session_id: null, history: [{ role: 'user', text: 'public fixture' }], personality: { humor: 70 } }]) {
      writeFileSync(file, JSON.stringify(record))
      assert.deepEqual(readResumeRecord(file), record)
    }
  } finally { rmSync(root, { recursive: true, force: true }) }
})
test('corrupt, invalid and oversized resume bytes are preserved, not treated as empty', () => {
  const root = mkdtempSync(join(tmpdir(), 'nori-resume-corrupt-')), file = join(root, 'resume.json')
  try {
    for (const bytes of ['', '{broken', 'null', '[]', '{"history":{}}', '{"history":[{"role":"system","text":"bad"}]}', 'x'.repeat(MAX_RESUME_BYTES + 1)]) {
      writeFileSync(file, bytes)
      assert.throws(() => readResumeRecord(file), /preserved; recovery is required/)
      assert.equal(readFileSync(file, 'utf8'), bytes)
    }
  } finally { rmSync(root, { recursive: true, force: true }) }
})
test('resume directories and redirected parent paths are refused without touching targets', () => {
  const root = mkdtempSync(join(tmpdir(), 'nori-resume-link-')), actual = join(root, 'actual'), link = join(root, 'redirect')
  try {
    mkdirSync(actual)
    writeFileSync(join(actual, 'resume.json'), '{"session_id":null}')
    assert.throws(() => readResumeRecord(actual), /recovery/)
    symlinkSync(actual, link, process.platform === 'win32' ? 'junction' : 'dir')
    assert.throws(() => readResumeRecord(join(link, 'resume.json')), /recovery/)
    assert.equal(readFileSync(join(actual, 'resume.json'), 'utf8'), '{"session_id":null}')
  } finally { try { unlinkSync(link) } finally { rmSync(root, { recursive: true, force: true }) } }
})

test('invalid UTF-8 history is rejected without replacement or byte changes', () => {
  const root = mkdtempSync(join(tmpdir(), 'nori-resume-encoding-')), file = join(root, 'resume.json')
  try {
    for (const invalid of [[0xff], [0xc3], [0xc0, 0xaf], [0xed, 0xa0, 0x80]]) {
      const bytes = Buffer.concat([Buffer.from('{"history":[{"role":"user","text":"'),
        Buffer.from(invalid), Buffer.from('"}]}')])
      writeFileSync(file, bytes)
      assert.throws(() => readResumeRecord(file), /preserved; recovery is required/)
      assert.deepEqual(readFileSync(file), bytes)
    }
    const valid = {history: [{role: 'user', text: 'Hello 🌌 — Nori'}]}
    writeFileSync(file, JSON.stringify(valid))
    assert.deepEqual(readResumeRecord(file), valid)
  } finally { rmSync(root, {recursive: true, force: true}) }
})
