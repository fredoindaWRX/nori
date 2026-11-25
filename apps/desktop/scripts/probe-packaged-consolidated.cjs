// Run only as: <package>/Nori.exe <package>/maintenance/desktop/this-file
// with ELECTRON_RUN_AS_NODE=1. This qualifies a generated sensor-denied probe,
// not production activation, a production Job, or exact descendant teardown.
const assert = require('node:assert/strict')
const { spawn, spawnSync } = require('node:child_process')
const { randomBytes } = require('node:crypto')
const { createServer: createHttpServer } = require('node:http')
const { createServer: createNetServer } = require('node:net')
const { lstatSync, realpathSync, mkdirSync, mkdtempSync, openSync, closeSync,
  fstatSync, readSync, writeFileSync } = require('node:fs')
const { basename, dirname, isAbsolute, join, resolve } = require('node:path')
const { lstat: lstatAsync } = require('node:fs/promises')

const SCRIPT_NAME = 'probe-packaged-consolidated.cjs'
const FIXTURE_PREFIX = '.native-browser-migration-packaged-'
const MAX_JSON_BYTES = 65536
const {readinessMs:READINESS_TIMEOUT_MS,totalMs:TOTAL_TIMEOUT_MS,cleanupMs:GUI_EXIT_TIMEOUT_MS} = require('./probe-deadlines.cjs')
const ROLES = Object.freeze(['sentinel', 'architect', 'oracle', 'trinity', 'neo',
  'morpheus', 'tank', 'keymaker', 'apoc', 'smith', 'machine', 'merovingian'])
const TOOL_NAMES = Object.freeze(['provision-private-state.ps1',
  'verify-private-state-acl.ps1', 'verify-browser-state-acl.ps1', 'browser-capability-sid.ps1'])
const normalize = value => process.platform === 'win32' ? value.toLowerCase() : value
const samePath = (left, right) => typeof left === 'string' && typeof right === 'string' &&
  isAbsolute(left) && normalize(resolve(left)) === normalize(left) && normalize(left) === normalize(right)

// Pure: import in unit tests without validating the source checkout or starting
// anything. Runtime callers never accept a candidate or state path argument.
function planPackagedConsolidatedPaths(scriptFile, fixtureName) {
  assert.ok(typeof scriptFile === 'string' && isAbsolute(scriptFile), 'Packaged probe path must be absolute')
  const script = resolve(scriptFile), desktop = dirname(script)
  assert.equal(basename(script), SCRIPT_NAME, 'Unexpected packaged probe filename')
  assert.equal(basename(desktop), 'desktop', 'Probe must be physically in maintenance/desktop')
  assert.equal(basename(dirname(desktop)), 'maintenance', 'Probe must be physically in maintenance/desktop')
  const packageRoot = resolve(desktop, '../..')
  const suiteRoot = join(packageRoot, 'resources', 'NoriSuite')
  const verification = join(suiteRoot, 'verification')
  const result = { script, packageRoot, suiteRoot, verification,
    executable: join(packageRoot, 'Nori.exe'), appArchive: join(packageRoot, 'resources', 'app.asar'),
    scriptsRoot: join(packageRoot, 'maintenance', 'scripts'),
    fixturePrefix: join(verification, FIXTURE_PREFIX) }
  if (fixtureName !== undefined) {
    assert.match(fixtureName, /^\.native-browser-migration-packaged-[A-Za-z0-9_-]+$/, 'Unsafe generated fixture name')
    const layoutRoot = join(verification, fixtureName)
    Object.assign(result, { layoutRoot, privateRoot: join(layoutRoot, 'state', 'private'),
      desktop: join(layoutRoot, 'state', 'private', 'desktop'),
      core: join(layoutRoot, 'state', 'private', 'core'), browser: join(layoutRoot, 'state', 'browser'),
      temp: join(layoutRoot, 'state', 'private', 'tmp') })
  }
  return Object.freeze(result)
}

function environmentValue(environment, name) {
  const key = Object.keys(environment).find(item => item.toUpperCase() === name)
  return key === undefined ? undefined : environment[key]
}

function packagedProbeEnvironment(environment, paths, { desktopPort, bridgePort, ownerUrl, ownerKey }) {
  assert.ok(paths.layoutRoot, 'Prepared generated layout is required')
  for (const port of [desktopPort, bridgePort]) assert.ok(Number.isInteger(port) && port > 0 && port <= 65535, 'Invalid probe port')
  assert.notEqual(desktopPort, bridgePort, 'Probe ports must differ')
  assert.match(ownerUrl, /^http:\/\/127\.0\.0\.1:\d{1,5}\/owner$/, 'Invalid private owner URL')
  assert.match(ownerKey, /^[A-Za-z0-9_-]{32,128}$/, 'Invalid private owner key')
  const systemRoot = environmentValue(environment, 'SYSTEMROOT')
  assert.ok(typeof systemRoot === 'string' && isAbsolute(systemRoot), 'Windows SystemRoot is required')
  const clean = {}
  for (const [name, value] of Object.entries(environment)) {
    if (/^(?:NORI_|LETTA_|NODE|PYTHON|ELECTRON_|NPM_|PIP_|CONDA_|UV_|CHROME|CHROMIUM)/i.test(name) ||
      /SANDBOX/i.test(name) || /^(?:PATH|TEMP|TMP|VIRTUAL_ENV|__COMPAT_LAYER)$/i.test(name)) continue
    clean[name] = value
  }
  // Native launchers use absolute packaged component paths. No source checkout,
  // user Node/Python installation, or inherited virtual environment is on PATH.
  return { ...clean, PATH: [join(systemRoot, 'System32'), systemRoot,
    join(systemRoot, 'System32', 'Wbem'), join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0')].join(';'),
    TEMP: paths.temp, TMP: paths.temp,
    NORI_DESKTOP_PORT: String(desktopPort), NORI_BRIDGE_PORT: String(bridgePort),
    NORI_WORKSPACE_PROBE_STATE: paths.desktop, NORI_WORKSPACE_PROBE_LAYOUT_ROOT: paths.layoutRoot,
    NORI_WORKSPACE_PROBE_OWNER_URL: ownerUrl, NORI_WORKSPACE_PROBE_OWNER_KEY: ownerKey,
    NORI_LEARNING_FILE: join(paths.desktop, 'probe-memory.json'),
    NORI_INFERENCE_RUNTIME: 'norllama', NORI_ALLOW_WRITES: '0' }
}

function packagedProvisionEnvironment(environment, paths) {
  assert.ok(typeof paths.layoutRoot === 'string' && isAbsolute(paths.layoutRoot), 'Generated provisioning root is required')
  // PowerShell can create a missing TEMP directory during its own startup.
  // Use the existing public fixture until the helper has created both protected
  // ACL roots; otherwise TEMP=private/tmp pre-creates the private destination.
  return { ...environment, TEMP: paths.layoutRoot, TMP: paths.layoutRoot }
}

function permissionToolDiagnostic(name, result, environment) {
  const credentials = Object.entries(environment).filter(([key, value]) =>
    /(?:KEY|TOKEN|PASSWORD|SECRET|CREDENTIAL)/i.test(key) && typeof value === 'string' && value.length)
    .map(([, value]) => value)
  const bounded = (value, limit) => {
    let text = value === undefined || value === null ? '' : String(value)
    for (const credential of credentials) text = text.split(credential).join('[redacted]')
    return text.slice(-limit)
  }
  return { tool: name, status: result.status ?? null, signal: result.signal ?? null,
    errorCode: bounded(result.error?.code, 128), errorMessage: bounded(result.error?.message, 256),
    stderrTail: bounded(result.stderr, 2048), stdoutTail: bounded(result.stdout, 2048) }
}

function validatePackagedReadiness(record, paths, bridgePort) {
  assert.ok(record && typeof record === 'object' && !Array.isArray(record), 'Invalid desktop readiness record')
  assert.equal(record.desktop_probe, 'READY', 'Desktop has not reached actual readiness')
  assert.equal(record.consolidatedStateSelected, true, 'Packaged consolidated state was not selected')
  for (const [field, expected] of [['privateProfile', paths.desktop], ['browserSession', paths.browser], ['selectedCoreState', paths.core]]) {
    assert.ok(samePath(record[field], expected), `Readiness ${field} differs from its prepared fixed path`)
  }
  assert.equal(record.sensorsDenied, true, 'Sensors must remain denied')
  assert.equal(record.captureDenied, true, 'Capture must remain denied')
  assert.equal(record.writesEnabled, false, 'Writes must remain disabled')
  const runtime = record.runtime
  assert.ok(runtime && typeof runtime === 'object' && !Array.isArray(runtime), 'Native runtime readiness is missing')
  assert.equal(runtime.runtime, 'NorLlama', 'Packaged probe requires NorLlama')
  assert.equal(runtime.backend, 'norama-independent', 'Packaged probe requires the independent backend')
  assert.equal(runtime.sensorsEnabled, 0, 'Native Core sensors must remain disabled')
  assert.equal(runtime.taskExecutionQualified, false, 'Native task execution must remain unqualified')
  assert.match(runtime.modelId || '', /^[A-Za-z0-9._:-]{1,128}$/, 'Invalid ready native model')
  for (const name of ['corePid', 'runtimePid', 'workerPid']) {
    assert.ok(Number.isSafeInteger(runtime[name]) && runtime[name] > 0, `Missing native ${name}`)
  }
  assert.ok(runtime.ports && typeof runtime.ports === 'object' && !Array.isArray(runtime.ports), 'Core ports are missing')
  assert.deepEqual(Object.keys(runtime.ports).sort(), [...ROLES].sort(), 'Exactly 12 named Core ports are required')
  for (const role of ROLES) assert.ok(Number.isInteger(runtime.ports[role]) && runtime.ports[role] > 0 && runtime.ports[role] <= 65535, 'Invalid Core port')
  assert.equal(new Set(Object.values(runtime.ports)).size, ROLES.length, 'Core ports must be unique')
  assert.equal(record.renderer?.connection?.workspaceProbe, true, 'Renderer did not enter workspace probe mode')
  assert.equal(record.renderer.connection.bridgeUrl, `ws://127.0.0.1:${bridgePort}`, 'Renderer bridge differs from the owned ephemeral port')
  return record
}

function validateRunningIdentityPanel(record, paths) {
  const text = record?.renderer?.installation?.text
  assert.equal(typeof text, 'string', 'Installation panel evidence is missing')
  for (const value of ['Which Nori is this?', 'NorLlama · native runtime',
    `App: ${paths.executable}`, `Suite: ${paths.suiteRoot}`, `Saved state: ${paths.desktop}`]) {
    assert.ok(text.includes(value), 'Running identity panel differs from actual packaged process or state')
  }
  return true
}

function assertPhysicalPath(target, kind) {
  assert.ok(isAbsolute(target) && normalize(resolve(target)) === normalize(target), 'Noncanonical physical path refused')
  let current = target, first = true
  for (;;) {
    const info = lstatSync(current)
    assert.equal(info.isSymbolicLink(), false, 'Linked packaged probe path or ancestor refused')
    assert.equal(normalize(realpathSync(current)), normalize(current), 'Redirected packaged probe path or ancestor refused')
    if (first && kind === 'file') assert.ok(info.isFile() && info.size > 0, 'Required packaged file is missing or empty')
    else assert.equal(info.isDirectory(), true, 'Packaged probe directory or ancestor is invalid')
    const next = dirname(current)
    if (next === current) break
    current = next; first = false
  }
  return target
}

function entryExists(target) {
  try { lstatSync(target); return true }
  catch (error) { if (error.code === 'ENOENT') return false; throw error }
}

// USB metadata can stall. Keep the authenticated owner heartbeat responsive
// while waiting for the desktop to publish its startup result.
async function entryExistsAsync(target, inspect = lstatAsync) {
  try { await inspect(target); return true }
  catch (error) { if (error.code === 'ENOENT') return false; throw error }
}

function readBoundedJson(target) {
  assertPhysicalPath(target, 'file')
  const handle = openSync(target, 'r')
  try {
    const info = fstatSync(handle)
    assert.ok(info.isFile() && info.size <= MAX_JSON_BYTES, 'Probe JSON exceeds 64 KiB or is not a file')
    const buffer = Buffer.alloc(MAX_JSON_BYTES + 1)
    let bytes = 0, read
    do { read = readSync(handle, buffer, bytes, buffer.length - bytes, bytes); bytes += read }
    while (read && bytes < buffer.length)
    assert.ok(bytes <= MAX_JSON_BYTES, 'Probe JSON grew beyond 64 KiB')
    return JSON.parse(buffer.subarray(0, bytes).toString('utf8').replace(/^\uFEFF/, ''))
  } finally { closeSync(handle) }
}

function remaining(deadline, maximum = Infinity) {
  const milliseconds = Math.min(maximum, deadline - Date.now())
  assert.ok(milliseconds > 0, 'Packaged probe exceeded its 120 second deadline')
  return milliseconds
}

function runPhysicalTool(paths, powershell, environment, name, argumentsList, deadline) {
  assert.ok(TOOL_NAMES.includes(name), 'Unexpected permission tool')
  const script = assertPhysicalPath(join(paths.scriptsRoot, name), 'file')
  const result = spawnSync(powershell, ['-NoLogo', '-NoProfile', '-NonInteractive', '-File', script, ...argumentsList],
    { cwd: paths.packageRoot, env: environment, encoding: 'utf8', windowsHide: true, shell: false,
      timeout: remaining(deadline, 15000), maxBuffer: MAX_JSON_BYTES })
  if (result.error || result.status !== 0) throw Object.assign(Error(`Packaged permission tool failed: ${name}`),
    { permissionTool: permissionToolDiagnostic(name, result, environment) })
}

async function reservePorts() {
  const servers = [createNetServer(), createNetServer()]
  try {
    for (const server of servers) await new Promise((done, reject) => {
      server.once('error', reject); server.listen({ port: 0, host: '127.0.0.1', exclusive: true }, done)
    })
    return servers.map(server => server.address().port)
  } finally {
    await Promise.all(servers.map(server => new Promise(done => server.close(done))))
  }
}

function ownerRecordPaths(paths) {
  return Object.fromEntries(['desktop', 'browser', 'core'].map(name => [name, join(paths[name], '.nori-state-owner.json')]))
}

async function main() {
  const startedAt = Date.now(), deadline = startedAt + TOTAL_TIMEOUT_MS
  let paths, owner, child, exitResult, exited, stopPromise, ownerClosed = false, heartbeatCount = 0
  let readiness, interrupted, diagnostic = '', cleanup = { originalGuiExited: false }
  const ownerKey = randomBytes(48).toString('base64url')
  const closeOwner = () => {
    if (!owner || ownerClosed) return
    ownerClosed = true
    owner.closeAllConnections(); owner.close()
  }
  const onSignal = () => { interrupted = true; closeOwner() }
  const stop = () => {
    if (stopPromise) return stopPromise
    stopPromise = (async () => {
      closeOwner()
      if (!child) return cleanup
      child.stdin.end()
      let timer
      const stopped = await Promise.race([exited.then(() => true), new Promise(done => {
        timer = setTimeout(() => done(false), Math.max(1, Math.min(GUI_EXIT_TIMEOUT_MS, deadline - Date.now())))
      })])
      clearTimeout(timer)
      cleanup = { originalGuiExited: stopped && exitResult?.error === undefined,
        exit: exitResult || null, stopMethod: 'closed-own-authenticated-loopback-heartbeat',
        exactDescendantDrainVerified: false, productionJobVerified: false, guardianVerified: false }
      if (!cleanup.originalGuiExited) throw Error('Original packaged GUI handle did not exit within 40 seconds; generated state and ownership records preserved')
      return cleanup
    })()
    return stopPromise
  }
  process.once('SIGINT', onSignal); process.once('SIGTERM', onSignal)
  try {
    assert.equal(process.platform, 'win32', 'Packaged consolidated acceptance requires Windows')
    assert.equal(process.argv.length, 2, 'Packaged probe accepts no candidate, state, or other CLI arguments')
    // Inspect the physical archive file, not Electron's virtual asar directory.
    // This affects only the Node-mode launcher, never the separately spawned GUI.
    process.noAsar = true
    paths = planPackagedConsolidatedPaths(__filename)
    assertPhysicalPath(paths.script, 'file'); assertPhysicalPath(paths.suiteRoot, 'directory')
    assertPhysicalPath(paths.appArchive, 'file'); assertPhysicalPath(paths.executable, 'file')
    assert.ok(samePath(process.execPath, paths.executable), 'Run this probe with its exact packaged Nori.exe')
    assert.equal(environmentValue(process.env, 'ELECTRON_RUN_AS_NODE'), '1', 'Probe launcher requires ELECTRON_RUN_AS_NODE=1')
    for (const name of TOOL_NAMES) assertPhysicalPath(join(paths.scriptsRoot, name), 'file')
    const systemRoot = environmentValue(process.env, 'SYSTEMROOT')
    const powershell = assertPhysicalPath(join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'), 'file')
    if (!entryExists(paths.verification)) mkdirSync(paths.verification)
    assertPhysicalPath(paths.verification, 'directory')
    const generated = mkdtempSync(paths.fixturePrefix)
    paths = planPackagedConsolidatedPaths(__filename, basename(generated))
    assertPhysicalPath(paths.layoutRoot, 'directory')
    owner = createHttpServer({ maxHeaderSize: 4096 }, (request, response) => {
      const authenticated = !ownerClosed && request.method === 'GET' && request.url === '/owner' &&
        request.headers.authorization === `Bearer ${ownerKey}`
      if (authenticated) heartbeatCount++
      response.writeHead(authenticated ? 200 : 403, { 'Cache-Control': 'no-store', Connection: 'close' }); response.end()
    })
    owner.requestTimeout = 1000; owner.headersTimeout = 1000
    await new Promise((done, reject) => { owner.once('error', reject); owner.listen(0, '127.0.0.1', done) })
    const ownerUrl = `http://127.0.0.1:${owner.address().port}/owner`
    const [desktopPort, bridgePort] = await reservePorts()
    const environment = packagedProbeEnvironment(process.env, paths, { desktopPort, bridgePort, ownerUrl, ownerKey })
    const provisionEnvironment = packagedProvisionEnvironment(environment, paths)
    // Both ACL roots are created with protected descriptors by shipped tools,
    // before anything private is written or the actual GUI is launched.
    assert.ok(!entryExists(paths.privateRoot) && !entryExists(paths.browser), 'Fresh protected provisioning destinations already exist; preserved')
    for (const storageClass of ['private', 'browser']) runPhysicalTool(paths, powershell, provisionEnvironment,
      'provision-private-state.ps1', ['-Root', paths.layoutRoot, '-StorageClass', storageClass, '-Apply'], deadline)
    for (const directory of [paths.desktop, paths.core, paths.temp]) { mkdirSync(directory); assertPhysicalPath(directory, 'directory') }
    const verifyPermissions = () => {
      runPhysicalTool(paths, powershell, environment, 'verify-private-state-acl.ps1', ['-Root', paths.privateRoot], deadline)
      runPhysicalTool(paths, powershell, environment, 'verify-browser-state-acl.ps1', ['-Root', paths.browser], deadline)
    }
    verifyPermissions()
    assert.ok(!interrupted, 'Packaged probe interrupted before GUI startup')
    remaining(deadline, 1)
    child = spawn(paths.executable, ['--workspace-probe', '--consolidated-layout-probe', '--manage-installation'],
      { cwd: paths.packageRoot, env: environment, windowsHide: true, shell: false, stdio: ['pipe', 'pipe', 'pipe'] })
    exited = new Promise(done => {
      child.once('exit', (code, signal) => { exitResult = { code, signal }; done(exitResult) })
      child.once('error', error => { exitResult = { error: error.code || 'SPAWN_ERROR' }; done(exitResult) })
    })
    child.stdin.on('error', () => {})
    const retainDiagnostic = bytes => { diagnostic = (diagnostic + bytes.toString('utf8')).slice(-4096) }
    child.stdout.on('data', retainDiagnostic); child.stderr.on('data', retainDiagnostic)
    // Reserve the final 40 seconds for the ORIGINAL GUI handle to leave.
    const readyDeadline = Math.min(Date.now() + READINESS_TIMEOUT_MS, deadline - GUI_EXIT_TIMEOUT_MS)
    const readyPath = join(paths.desktop, 'desktop-readiness.json'), failurePath = join(paths.desktop, 'desktop-failure.json')
    for (;;) {
      assert.ok(!interrupted, 'Packaged probe interrupted')
      if (await entryExistsAsync(failurePath)) { readBoundedJson(failurePath); throw Error('Actual packaged desktop reported startup failure; its failure record is preserved') }
      if (exitResult) throw Error('Original packaged GUI exited before qualified readiness')
      if (await entryExistsAsync(readyPath)) { readiness = validatePackagedReadiness(readBoundedJson(readyPath), paths, bridgePort); break }
      assert.ok(Date.now() < readyDeadline, 'Actual packaged desktop readiness deadline exceeded')
      await new Promise(done => setTimeout(done, 50))
    }
    assert.ok(heartbeatCount > 0, 'Original packaged GUI did not authenticate to its own heartbeat')
    validateRunningIdentityPanel(readiness, paths)
    for (const [name, path] of Object.entries(ownerRecordPaths(paths))) {
      const record = readBoundedJson(path)
      assert.equal(record.schema, 1, 'Invalid ordinary state ownership record')
      assert.equal(record.pid, child.pid, 'Ordinary state ownership differs from the original GUI handle')
      assert.equal(record.purpose, name === 'core' ? 'core' : 'desktop', 'Ordinary state ownership purpose differs')
    }
    await stop()
    assert.equal(exitResult.code, 0, 'Original packaged GUI did not exit successfully')
    assert.equal(exitResult.signal, null, 'Original packaged GUI was terminated by a signal')
    const ordinaryOwnershipReleased = Object.fromEntries(Object.entries(ownerRecordPaths(paths)).map(([name, path]) => [name, !entryExists(path)]))
    assert.ok(Object.values(ordinaryOwnershipReleased).every(Boolean), 'Ordinary desktop/browser/Core ownership records remain; state preserved')
    assert.ok(!entryExists(failurePath), 'Desktop produced a late failure record; state preserved')
    verifyPermissions()
    const receiptPath = join(paths.desktop, 'packaged-consolidated-probe-receipt.json')
    const receipt = { schema: 1, packagedConsolidatedProbe: 'PASS', syntheticOnly: true,
      executable: paths.executable, suiteRoot: paths.suiteRoot, generatedLayoutRoot: paths.layoutRoot,
      preparedFixedPaths: { desktop: paths.desktop, core: paths.core, browser: paths.browser },
      desktopPort, bridgePort, actualReadiness: readiness, authenticatedHeartbeatObserved: true,
      runningIdentityPanelVerified: true,
      ordinaryOwnershipReleased, privateAclVerifiedBeforeAndAfter: true, browserAclVerifiedBeforeAndAfter: true,
      browserAclPolicy: 'bounded-shared-Chromium-network-capability-scopes', cleanup,
      sourceIndependentLaunch: true, elapsedMilliseconds: Date.now() - startedAt,
      productionActivationVerified: false, releaseVerified: false }
    remaining(deadline)
    assertPhysicalPath(paths.desktop, 'directory')
    writeFileSync(receiptPath, JSON.stringify(receipt, null, 2) + '\n', { flag: 'wx', mode: 0o600 })
    console.log(JSON.stringify({ packagedConsolidatedProbe: 'PASS', evidence: receiptPath,
      generatedStatePreserved: paths.layoutRoot, originalGuiExited: true,
      exactDescendantDrainVerified: false, productionJobVerified: false, guardianVerified: false,
      productionActivationVerified: false }))
  } catch (error) {
    let cleanupError
    try { await stop() } catch (failure) { cleanupError = failure.message }
    const failure = { schema: 1, packagedConsolidatedProbe: 'FAIL', error: error.message,
      permissionTool: error.permissionTool,
      cleanupError, cleanup, generatedStatePreserved: paths?.layoutRoot,
      diagnosticTail: diagnostic.split(ownerKey).join('[private-owner-key]'),
      elapsedMilliseconds: Date.now() - startedAt, productionActivationVerified: false,
      exactDescendantDrainVerified: false, productionJobVerified: false, guardianVerified: false }
    if (paths?.desktop && entryExists(paths.desktop)) {
      try {
        assertPhysicalPath(paths.desktop, 'directory')
        writeFileSync(join(paths.desktop, 'packaged-consolidated-probe-failure.json'),
          JSON.stringify(failure, null, 2) + '\n', { flag: 'wx', mode: 0o600 })
      } catch { /* Never replace a foreign/existing record or delete failed state. */ }
    }
    console.error(JSON.stringify({ ...failure, diagnosticTail: undefined }))
    process.exitCode = 1
  } finally {
    closeOwner()
    // Descendants may still hold inherited pipes. Their closure is not proof of
    // descendant drain; only the original GUI's exit event qualifies above.
    if (child) { child.stdin.destroy(); child.stdout.destroy(); child.stderr.destroy(); child.unref() }
    process.removeListener('SIGINT', onSignal); process.removeListener('SIGTERM', onSignal)
  }
}

module.exports = { planPackagedConsolidatedPaths, packagedProbeEnvironment, packagedProvisionEnvironment,
  permissionToolDiagnostic, validatePackagedReadiness, validateRunningIdentityPanel, entryExistsAsync }
if (require.main === module) void main()
