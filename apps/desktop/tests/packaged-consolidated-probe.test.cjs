const test = require('node:test')
const assert = require('node:assert/strict')
const { join, resolve, dirname, basename } = require('node:path')
const { tmpdir } = require('node:os')
const { mkdtempSync, existsSync, rmSync } = require('node:fs')
const { spawnSync } = require('node:child_process')
const originalNoAsar = process.noAsar
const { entryExistsAsync } = require('../scripts/probe-packaged-consolidated.cjs')

test('slow readiness metadata leaves the owner event loop responsive', async () => {
  let finishMetadata, ownerServiced = false
  const pending = entryExistsAsync('synthetic-only', () => new Promise(resolve => { finishMetadata = resolve }))
  await new Promise(resolve => setImmediate(() => { ownerServiced = true; resolve() }))
  assert.equal(ownerServiced, true)
  finishMetadata({})
  assert.equal(await pending, true)
})

test('async readiness treats only missing files as absent and propagates access failures', async () => {
  assert.equal(await entryExistsAsync('synthetic-only', async () => { throw Object.assign(Error('missing'), { code: 'ENOENT' }) }), false)
  await assert.rejects(entryExistsAsync('synthetic-only', async () => { throw Object.assign(Error('denied'), { code: 'EACCES' }) }), { code: 'EACCES' })
})
const { planPackagedConsolidatedPaths, packagedProbeEnvironment, packagedProvisionEnvironment,
  permissionToolDiagnostic, validatePackagedReadiness } =
  require('../scripts/probe-packaged-consolidated.cjs')

const packageRoot = resolve(tmpdir(), 'synthetic-nori-package-not-created')
const script = join(packageRoot, 'maintenance', 'desktop', 'probe-packaged-consolidated.cjs')
const fixtureName = '.native-browser-migration-packaged-synthetic'
const paths = planPackagedConsolidatedPaths(script, fixtureName)
const roles = ['sentinel', 'architect', 'oracle', 'trinity', 'neo', 'morpheus',
  'tank', 'keymaker', 'apoc', 'smith', 'machine', 'merovingian']
const ready = () => ({ desktop_probe: 'READY', consolidatedStateSelected: true,
  privateProfile: paths.desktop, browserSession: paths.browser, selectedCoreState: paths.core,
  sensorsDenied: true, captureDenied: true, writesEnabled: false,
  renderer: { connection: { workspaceProbe: true, bridgeUrl: 'ws://127.0.0.1:43210' } },
  runtime: { runtime: 'NorLlama', backend: 'norama-independent', modelId: 'synthetic-model',
    corePid: 100, runtimePid: 101, workerPid: 102, sensorsEnabled: 0, taskExecutionQualified: false,
    ports: Object.fromEntries(roles.map((role, index) => [role, 44000 + index])) } })

test('import only plans fixed packaged paths without starting Electron or creating state', () => {
  assert.equal(process.noAsar, originalNoAsar)
  assert.equal(paths.packageRoot, packageRoot)
  assert.equal(paths.executable, join(packageRoot, 'Nori.exe'))
  assert.equal(paths.suiteRoot, join(packageRoot, 'resources', 'NoriSuite'))
  assert.equal(paths.scriptsRoot, join(packageRoot, 'maintenance', 'scripts'))
  assert.equal(paths.layoutRoot, join(paths.suiteRoot, 'verification', fixtureName))
  assert.equal(paths.desktop, join(paths.layoutRoot, 'state', 'private', 'desktop'))
  assert.equal(paths.core, join(paths.layoutRoot, 'state', 'private', 'core'))
  assert.equal(paths.browser, join(paths.layoutRoot, 'state', 'browser'))
  assert.equal(Object.isFrozen(paths), true)
  assert.equal(planPackagedConsolidatedPaths(script).layoutRoot, undefined)
})

test('planner refuses source scripts, arbitrary filename and arbitrary fixture paths', () => {
  for (const file of [join(packageRoot, 'apps', 'desktop', 'scripts', 'probe-packaged-consolidated.cjs'),
    join(packageRoot, 'maintenance', 'desktop', 'other.cjs'), 'relative/maintenance/desktop/probe-packaged-consolidated.cjs']) {
    assert.throws(() => planPackagedConsolidatedPaths(file, fixtureName))
  }
  for (const name of ['state', '.native-browser-migration-owner', '../' + fixtureName,
    fixtureName + '/state', '.native-browser-migration-packaged-', packageRoot]) {
    assert.throws(() => planPackagedConsolidatedPaths(script, name), /Unsafe generated fixture/)
  }
})

test('GUI environment removes inherited overrides case-insensitively and fixes generated state/ports', () => {
  const systemRoot = resolve(tmpdir(), 'synthetic-windows-not-created')
  const environment = packagedProbeEnvironment({ SystemRoot: systemRoot, USERNAME: 'synthetic',
    Path: 'SOURCE-NODE-PYTHON', nori_ROOT: 'unrelated-source', NORI_ALLOW_WRITES: '1',
    LeTtA_API_KEY: 'foreign-key', NODE_OPTIONS: '--require foreign', NODE_PATH: 'foreign',
    pythonPATH: 'foreign', PYTHONHOME: 'foreign', ELECTRON_RUN_AS_NODE: '1',
    ELECTRON_DISABLE_SANDBOX: '1', CHROMIUM_FLAGS: '--no-sandbox', CUSTOM_SANDBOX_OVERRIDE: '1',
    VIRTUAL_ENV: 'foreign', CONDA_PREFIX: 'foreign', NPM_CONFIG_NODE_OPTIONS: 'foreign',
    TEMP: 'personal-temp', TMP: 'personal-temp' }, paths,
  { desktopPort: 43209, bridgePort: 43210, ownerUrl: 'http://127.0.0.1:43211/owner',
    ownerKey: 'synthetic-private-owner-key-0123456789' })
  assert.equal(environment.NORI_WORKSPACE_PROBE_STATE, paths.desktop)
  assert.equal(environment.NORI_WORKSPACE_PROBE_LAYOUT_ROOT, paths.layoutRoot)
  assert.equal(environment.NORI_DESKTOP_PORT, '43209')
  assert.equal(environment.NORI_BRIDGE_PORT, '43210')
  assert.equal(environment.NORI_INFERENCE_RUNTIME, 'norllama')
  assert.equal(environment.NORI_ALLOW_WRITES, '0')
  assert.equal(environment.TEMP, paths.temp)
  assert.equal(environment.TMP, paths.temp)
  assert.equal(environment.USERNAME, 'synthetic')
  assert.equal(environment.PATH.includes('SOURCE-NODE-PYTHON'), false)
  assert.equal(environment.PATH, [join(systemRoot, 'System32'), systemRoot,
    join(systemRoot, 'System32', 'Wbem'), join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0')].join(';'))
  for (const name of ['nori_ROOT', 'LeTtA_API_KEY', 'NODE_OPTIONS', 'NODE_PATH', 'pythonPATH', 'PYTHONHOME',
    'ELECTRON_RUN_AS_NODE', 'ELECTRON_DISABLE_SANDBOX', 'CHROMIUM_FLAGS', 'CUSTOM_SANDBOX_OVERRIDE',
    'VIRTUAL_ENV', 'CONDA_PREFIX', 'NPM_CONFIG_NODE_OPTIONS', 'Path']) assert.equal(environment[name], undefined)
})

test('provisioning bootstrap uses the existing generated root before private temp exists', () => {
  const runtimeEnvironment = { TEMP: paths.temp, TMP: paths.temp, NORI_ALLOW_WRITES: '0' }
  const bootstrap = packagedProvisionEnvironment(runtimeEnvironment, paths)
  assert.equal(bootstrap.TEMP, paths.layoutRoot)
  assert.equal(bootstrap.TMP, paths.layoutRoot)
  assert.equal(bootstrap.NORI_ALLOW_WRITES, '0')
  assert.equal(runtimeEnvironment.TEMP, paths.temp)
  assert.equal(runtimeEnvironment.TMP, paths.temp)
})

test('permission tool diagnostics are bounded and redact credentials', () => {
  const key = 'synthetic-owner-key-never-logged'
  const diagnostic = permissionToolDiagnostic('provision-private-state.ps1', {
    status: 1, signal: null, error: { code: 'ETIMEDOUT', message: 'failed with ' + key },
    stderr: 'x'.repeat(9000) + key, stdout: 'y'.repeat(9000) + 'synthetic-api-token' },
  { NORI_WORKSPACE_PROBE_OWNER_KEY: key, FOREIGN_API_TOKEN: 'synthetic-api-token' })
  assert.equal(diagnostic.status, 1)
  assert.equal(diagnostic.errorCode, 'ETIMEDOUT')
  assert.ok(diagnostic.stderrTail.length <= 2048)
  assert.ok(diagnostic.stdoutTail.length <= 2048)
  assert.ok(diagnostic.errorMessage.length <= 256)
  const serialized = JSON.stringify(diagnostic)
  assert.equal(serialized.includes(key), false)
  assert.equal(serialized.includes('synthetic-api-token'), false)
  assert.equal(serialized.includes('[redacted]'), true)
})

test('Windows PowerShell bootstrap preserves missing private state until protected provisioning',
  { skip: process.platform !== 'win32', timeout: 20000 }, t => {
    const trial = mkdtempSync(join(tmpdir(), 'nori-packaged-provision-test-'))
    t.after(() => {
      assert.equal(dirname(resolve(trial)), resolve(tmpdir()))
      assert.match(basename(trial), /^nori-packaged-provision-test-[A-Za-z0-9_-]+$/)
      rmSync(trial, { recursive: true, force: true })
    })
    const privateRoot = join(trial, 'state', 'private'), privateTemp = join(privateRoot, 'tmp')
    const environment = packagedProvisionEnvironment({ ...process.env, TEMP: privateTemp, TMP: privateTemp }, { layoutRoot: trial })
    const powershell = join(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
    const run = argumentsList => {
      const result = spawnSync(powershell, ['-NoLogo', '-NoProfile', '-NonInteractive', ...argumentsList],
        { env: environment, encoding: 'utf8', windowsHide: true, shell: false, timeout: 5000, maxBuffer: 65536 })
      assert.equal(result.error, undefined)
      assert.equal(result.status, 0, JSON.stringify(permissionToolDiagnostic('synthetic-bootstrap', result, environment)))
    }
    assert.equal(existsSync(privateRoot), false)
    run(['-Command', 'exit 0'])
    assert.equal(existsSync(privateRoot), false, 'PowerShell startup must not pre-create the private destination')
    run(['-File', join(__dirname, '../scripts/provision-private-state.ps1'), '-Root', trial, '-StorageClass', 'private', '-Apply'])
    assert.equal(existsSync(privateRoot), true)
    assert.equal(existsSync(privateTemp), false)
    run(['-File', join(__dirname, '../scripts/verify-private-state-acl.ps1'), '-Root', privateRoot])
  })

test('readiness requires fixed consolidated paths and the independent sensor-denied native runtime', () => {
  const record = ready()
  assert.equal(validatePackagedReadiness(record, paths, 43210), record)
  for (const [field, value] of [['desktop_probe', 'STARTING'], ['consolidatedStateSelected', false],
    ['privateProfile', paths.core], ['browserSession', paths.desktop], ['selectedCoreState', paths.desktop],
    ['sensorsDenied', false], ['captureDenied', false], ['writesEnabled', true]]) {
    assert.throws(() => validatePackagedReadiness({ ...ready(), [field]: value }, paths, 43210))
  }
  const noncanonical = { ...ready(), privateProfile: paths.desktop + '/./' }
  assert.throws(() => validatePackagedReadiness(noncanonical, paths, 43210), /fixed path/)
  for (const [field, value] of [['runtime', 'Ollama'], ['backend', 'borrowed'], ['sensorsEnabled', 1],
    ['taskExecutionQualified', true], ['corePid', 0], ['modelId', '']]) {
    const bad = ready(); bad.runtime[field] = value
    assert.throws(() => validatePackagedReadiness(bad, paths, 43210))
  }
})

test('readiness requires all 12 unique named Core ports and the owned renderer bridge', () => {
  const badRecords = []
  let record = ready(); delete record.runtime.ports.sentinel; badRecords.push(record)
  record = ready(); record.runtime.ports.extra = 45000; badRecords.push(record)
  record = ready(); record.runtime.ports.sentinel = record.runtime.ports.architect; badRecords.push(record)
  record = ready(); record.runtime.ports.sentinel = 65536; badRecords.push(record)
  record = ready(); record.runtime.ports.sentinel = 44000.5; badRecords.push(record)
  record = ready(); record.renderer.connection.workspaceProbe = false; badRecords.push(record)
  record = ready(); record.renderer.connection.bridgeUrl = 'ws://127.0.0.1:8787'; badRecords.push(record)
  for (const bad of badRecords) assert.throws(() => validatePackagedReadiness(bad, paths, 43210))
})
