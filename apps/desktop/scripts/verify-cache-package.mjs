// Capture the standalone packaged verifier's actual result and exit, not a GUI-shell dispatch.
import assert from 'node:assert/strict'
import {spawnSync} from 'node:child_process'
import {createHash} from 'node:crypto'
import {existsSync, readFileSync, writeFileSync} from 'node:fs'
import {join, resolve} from 'node:path'
import {packagedProbeOptions} from './packaged-probe-options.mjs'
const root = resolve(import.meta.dirname, '../../..')
const options = packagedProbeOptions(process.argv.slice(2), 'integrity')
const candidate = join(root, `apps/desktop/release/native-desktop-${options.candidate}`)
const packageRoot = join(candidate, 'win-unpacked')
const output = join(root, 'verification', options.evidence)
if (existsSync(output)) throw Error('Existing package verification evidence preserved')
const receipt = join(candidate, 'native-desktop-receipt.json')
const sha256 = () => createHash('sha256').update(readFileSync(receipt)).digest('hex')
const before = sha256()
const result = spawnSync(join(packageRoot, 'Nori.exe'),
  [join(packageRoot, 'backup-tools/verify-portable-native.mjs'), packageRoot, receipt],
  {cwd: packageRoot, env: {...process.env, ELECTRON_RUN_AS_NODE: '1'}, windowsHide: true,
    shell: false, encoding: 'utf8', timeout: 180000, maxBuffer: 65536})
const report = {schema: 'nori.cache-package-integrity.v1', passed: false, receiptSha256: before,
  processExit: result.status, releaseVerified: false}
try {
  assert.equal(result.status, 0, result.stderr || result.error?.message || 'Verifier failed')
  report.result = JSON.parse(result.stdout.trim())
  assert.equal(report.result.desktopIntegrityVerified, true)
  assert.equal(report.result.payloadIntegrityVerified, true)
  assert.equal(report.result.sourceTreeRequired, false)
  assert.equal(report.result.installedSuiteVerified, false)
  assert.equal(sha256(), before)
  report.passed = true
} catch (error) {
  report.failure = {type: error.name, message: error.message}
  throw error
} finally {
  writeFileSync(output, JSON.stringify(report, null, 2) + '\n', {flag: 'wx'})
}
console.log(JSON.stringify(report))
