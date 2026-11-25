import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { desktopTestSourceManifest, parseNodeTestSummary } from '../scripts/test-with-journal.mjs'

test('desktop test summary parser records only numeric runner totals', () => {
  assert.deepEqual(parseNodeTestSummary('ℹ tests 14\nℹ pass 13\nℹ fail 1\nℹ cancelled 0\nℹ skipped 0\nℹ todo 0\n'), {
    tests: 14, pass: 13, fail: 1, cancelled: 0, skipped: 0, todo: 0,
  })
  assert.deepEqual(parseNodeTestSummary('unrecognized output containing private text'), {
    tests: null, pass: null, fail: null, cancelled: null, skipped: null, todo: null,
  })
})

test('desktop test manifest binds package, lockfile and every desktop test source deterministically', async () => {
  const root = await mkdtemp(join(tmpdir(), 'nori-test-manifest-'))
  try {
    const app = join(root, 'apps/desktop')
    await mkdir(join(app, 'tests'), { recursive: true })
    await writeFile(join(app, 'package.json'), '{"scripts":{"test":"node --test"}}\n')
    await writeFile(join(app, 'package-lock.json'), '{"lockfileVersion":3}\n')
    await writeFile(join(app, 'tests', 'a.test.mjs'), 'test("a",()=>{})\n')
    await writeFile(join(app, 'tests', 'b.test.cjs'), 'test("b",()=>{})\n')
    await writeFile(join(app, 'tests', 'not-a-test.js'), 'ignored\n')

    const first = desktopTestSourceManifest(root)
    const second = desktopTestSourceManifest(root)
    assert.deepEqual(first, second)
    assert.deepEqual(first.files.map(file => file.path), [
      'apps/desktop/package.json', 'apps/desktop/package-lock.json',
      'apps/desktop/tests/a.test.mjs', 'apps/desktop/tests/b.test.cjs',
    ])
    await writeFile(join(app, 'tests', 'b.test.cjs'), 'test("changed",()=>{})\n')
    assert.notEqual(desktopTestSourceManifest(root).sha256, first.sha256)
    await writeFile(join(app, 'tests', 'b.test.cjs'), 'test("b",()=>{})\n')
    await mkdir(join(app,'bridge'))
    await writeFile(join(app,'bridge','planner.mjs'),'export const version=1\n')
    const withImplementation=desktopTestSourceManifest(root)
    assert.ok(withImplementation.files.some(file=>file.path==='apps/desktop/bridge/planner.mjs'))
    await writeFile(join(app,'bridge','planner.mjs'),'export const version=2\n')
    assert.notEqual(desktopTestSourceManifest(root).sha256,withImplementation.sha256)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
