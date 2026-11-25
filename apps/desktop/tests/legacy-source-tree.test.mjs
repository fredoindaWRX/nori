import {test} from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, symlinkSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {compareLegacySourceTree} from '../scripts/compare-legacy-source-tree.mjs'

test('classifies source differences without mutating either tree; excludes dependencies', () => {
  const root = mkdtempSync(join(tmpdir(), 'nori-legacy-compare-'))
  try {
    const old = join(root, 'old'), current = join(root, 'current')
    mkdirSync(old); mkdirSync(current)
    for (const path of [old, current]) writeFileSync(join(path, 'same.py'), 'same')
    writeFileSync(join(old, 'changed.py'), 'old'); writeFileSync(join(current, 'changed.py'), 'new')
    writeFileSync(join(old, 'missing.py'), 'preserve')
    mkdirSync(join(old, 'node_modules')); writeFileSync(join(old, 'node_modules', 'vendor.js'), 'vendor')
    const report = compareLegacySourceTree(old, current)
    assert.deepEqual(Object.fromEntries(report.results.map(row => [row.path, row.status])), {
      'changed.py': 'different', 'missing.py': 'canonical-missing', 'same.py': 'identical'})
    assert.equal(report.cleanupQualified, false)
    assert.equal(readFileSync(join(old, 'missing.py'), 'utf8'), 'preserve')
    assert.equal(readFileSync(join(current, 'changed.py'), 'utf8'), 'new')
  } finally {rmSync(root, {recursive: true, force: true})}
})

test('refuses linked directory ancestry', () => {
  const root = mkdtempSync(join(tmpdir(), 'nori-legacy-link-'))
  try {
    mkdirSync(join(root, 'real')); mkdirSync(join(root, 'current'))
    symlinkSync(join(root, 'real'), join(root, 'alias'), process.platform === 'win32' ? 'junction' : 'dir')
    assert.throws(() => compareLegacySourceTree(join(root, 'alias'), join(root, 'current')), /Linked/)
  } finally {rmSync(root, {recursive: true, force: true})}
})
