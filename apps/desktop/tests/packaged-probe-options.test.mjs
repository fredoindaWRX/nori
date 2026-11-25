import test from 'node:test'
import assert from 'node:assert/strict'
import {packagedProbeOptions} from '../scripts/packaged-probe-options.mjs'

test('historical default evidence names are preserved', () => {
  assert.equal(packagedProbeOptions([], 'launcher').evidence, 'nori-cache-packaged-launcher-2026-10-05.json')
  assert.equal(packagedProbeOptions([], 'integrity').evidence, 'nori-cache-package-integrity-2026-10-05.json')
})
test('new candidates have distinct evidence names and cannot redirect paths', () => {
  assert.deepEqual(packagedProbeOptions(['--candidate=installer-20261006'], 'launcher'), {
    candidate: 'installer-20261006', evidence: 'nori-packaged-launcher-installer-20261006.json',
  })
  for (const value of ['../owner', 'C:\\Nori', '/tmp/test', '', 'a/b', 'A', 'a'.repeat(65), 'a b']) {
    assert.throws(() => packagedProbeOptions([`--candidate=${value}`], 'launcher'))
  }
})
test('unknown, duplicate and output/profile/executable overrides are refused', () => {
  for (const args of [['--output=x'], ['--profile=x'], ['--executable=x'], ['--candidate=a', '--candidate=b']]) {
    assert.throws(() => packagedProbeOptions(args, 'launcher'))
  }
  assert.throws(() => packagedProbeOptions([], 'unknown'))
})
