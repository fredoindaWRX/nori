// Capture a real packaged GUI probe without borrowing the owner profile or sensors.
import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
import {existsSync, readFileSync, writeFileSync} from 'node:fs'
import {join, resolve} from 'node:path'
import {spawnSync} from 'node:child_process'
const root = resolve(import.meta.dirname, '../../..')
const candidate = join(root, 'apps/desktop/release/native-desktop-launcher-cachebinding-20261005')
const packageRoot = join(candidate, 'win-unpacked')
const output = join(root, 'verification/nori-cache-packaged-gui-2026-10-05.json')
if (existsSync(output)) throw Error('Existing GUI evidence preserved')
const receiptPath = join(candidate, 'native-desktop-receipt.json')
const hash = bytes => createHash('sha256').update(bytes).digest('hex')
const receiptHash = hash(readFileSync(receiptPath))
const script = join(packageRoot, 'maintenance/desktop/probe-packaged-consolidated.cjs')
assert.equal(hash(readFileSync(script)), hash(readFileSync(join(import.meta.dirname, 'probe-packaged-consolidated.cjs'))))
const report = {schema: 'nori.cache-packaged-gui.v1', passed: false,
  receiptSha256: receiptHash, helperSha256: hash(readFileSync(script)), releaseVerified: false,
  productionActivationVerified: false, installedSuiteVerified: false,
  limits: ['Actual packaged GUI and renderer in sensor-denied/write-denied generated protected profile.',
    'No owner profile, installation, physical sensors, task-planning quality or exact Job descendant drain qualification.']}
const child = spawnSync(join(packageRoot, 'Nori.exe'), [script],
  {cwd: packageRoot, env: {...process.env, ELECTRON_RUN_AS_NODE: '1'}, windowsHide: true,
    shell: false, encoding: 'utf8', timeout: 150000, maxBuffer: 65536})
report.processExit = child.status
try {
  if (child.status !== 0) {
    try { report.probeFailure = JSON.parse(child.stderr.trim()) } catch { report.probeFailure = {message: 'Probe failed without a bounded JSON failure record'} }
    throw Error('Actual packaged GUI acceptance failed; generated state preserved')
  }
  const result = JSON.parse(child.stdout.trim())
  assert.equal(result.packagedConsolidatedProbe, 'PASS')
  const evidence = resolve(result.evidence)
  assert.ok(evidence.startsWith(join(packageRoot, 'resources/NoriSuite/verification') + '\\'))
  const bytes = readFileSync(evidence)
  assert.ok(bytes.length <= 65536)
  const accepted = JSON.parse(bytes)
  assert.equal(accepted.packagedConsolidatedProbe, 'PASS')
  assert.equal(accepted.actualReadiness.runtime.cachePrecision, 'f32')
  assert.equal(accepted.sourceIndependentLaunch, true)
  assert.equal(accepted.actualReadiness.sensorsDenied, true)
  assert.equal(accepted.actualReadiness.writesEnabled, false)
  assert.equal(accepted.cleanup.originalGuiExited, true)
  report.acceptanceEvidence = evidence
  report.acceptanceSha256 = hash(bytes)
  report.generatedStatePreserved = result.generatedStatePreserved
  report.actualReadiness = accepted.actualReadiness
  const pids = ['corePid', 'runtimePid', 'workerPid'].map(name => accepted.actualReadiness.runtime[name])
  assert.ok(pids.every(pid => Number.isSafeInteger(pid) && pid > 0))
  const filter = pids.map(pid => `ProcessId = ${pid}`).join(' OR ')
  const check = spawnSync(join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe'),
    ['-NoProfile', '-Command', `if (Get-CimInstance Win32_Process -Filter '${filter}') { exit 1 } else { exit 0 }`],
    {windowsHide: true, shell: false, encoding: 'utf8', timeout: 10000})
  assert.equal(check.status, 0, 'An observed native component PID survived GUI shutdown')
  report.observedComponentPidsAbsent = true
  assert.equal(hash(readFileSync(receiptPath)), receiptHash)
  report.passed = true
} catch (error) {
  report.failure = {type: error.name, message: error.message}
  throw error
} finally {
  writeFileSync(output, JSON.stringify(report, null, 2) + '\n', {flag: 'wx'})
}
console.log(JSON.stringify({passed: true, actualGuiReadiness: true, cachePrecision: 'f32',
  observedComponentPidsAbsent: true, installedSuiteVerified: false, releaseVerified: false}))
