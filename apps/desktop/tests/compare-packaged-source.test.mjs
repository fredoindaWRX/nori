import {test} from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync, mkdirSync, writeFileSync, rmSync} from 'node:fs'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {createHash} from 'node:crypto'
import {comparePackagedSource} from '../scripts/compare-packaged-source.mjs'

test('compares actual bytes, reports missing and changed source, rejects receipt mismatch', () => {
  const root = mkdtempSync(join(tmpdir(), 'nori-source-compare-'))
  try {
    const canonical = join(root, 'canonical'), suite = join(root, 'suite')
    mkdirSync(join(canonical, 'nori'), {recursive: true})
    mkdirSync(join(suite, 'nori'), {recursive: true})
    const files = ['same', 'changed', 'missing', 'corrupt'].map(name => {
      writeFileSync(join(suite, 'nori', `${name}.py`), 'old')
      return {path: `nori/${name}.py`, sha256: createHash('sha256').update('old').digest('hex')}
    })
    writeFileSync(join(canonical, 'nori', 'same.py'), 'old')
    writeFileSync(join(canonical, 'nori', 'changed.py'), 'new')
    writeFileSync(join(suite, 'nori', 'corrupt.py'), 'modified')
    files.push({path: 'nori/.venv/site-packages/vendor.py', sha256: 'not-used'})
    files.push({path: 'nori/knights/architect/lib/cli/templates/{{folder}}/tool.py', sha256: 'not-used'})
    const result = comparePackagedSource(canonical, suite, {files})
    assert.deepEqual(result.results.map(row => row.status), ['identical', 'different', 'canonical-missing', 'packaged-receipt-mismatch'])
    assert.equal(result.cleanupQualified, false)
    assert.equal(result.fullBuildCompared, false)
    assert.throws(() => comparePackagedSource(canonical, suite, {files: [files[0], files[0]]}), /Invalid source receipt/)
  } finally { rmSync(root, {recursive: true, force: true}) }
})
