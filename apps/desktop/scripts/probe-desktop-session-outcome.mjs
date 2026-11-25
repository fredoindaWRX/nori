// Fresh source-only Windows fixtures. Health evidence is not authenticated
// guardian authority, installed acceptance, or exact descendant-drain proof.
import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { createServer as createHttpServer } from 'node:http'
import { createServer as createNetServer } from 'node:net'
import { createHash, randomBytes } from 'node:crypto'
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'
const { packagedProbeEnvironment, packagedProvisionEnvironment, validatePackagedReadiness } =
  createRequire(import.meta.url)('./probe-packaged-consolidated.cjs')
const { FAILURE_CODES } = createRequire(import.meta.url)('../desktop/desktop-session-outcome.cjs')
const root = resolve(fileURLToPath(new URL('../../../', import.meta.url)))
const desktopRoot = join(root, 'apps/desktop')
const modes = ['normal', 'startup-failure', 'native-exit']
const sources = ['desktop/main.cjs', 'desktop/native-stack.cjs', 'desktop/desktop-session-outcome.cjs',
  'desktop/native-service.cjs', 'desktop/native-core.cjs', 'desktop/workspace-probe.cjs',
  'scripts/probe-desktop-session-outcome.mjs', 'scripts/probe-packaged-consolidated.cjs',
  'scripts/provision-private-state.ps1', 'scripts/verify-private-state-acl.ps1',
  'scripts/verify-browser-state-acl.ps1', 'scripts/browser-capability-sid.ps1']
const hash = file => createHash('sha256').update(readFileSync(file)).digest('hex')
const measure = () => Object.fromEntries(sources.map(file => [file, hash(join(desktopRoot, file))]))
const wait = ms => new Promise(done => setTimeout(done, ms))

export function validateSessionOutcome(record, mode, originalPid) {
  assert.ok(modes.includes(mode), 'Unknown session outcome probe mode')
  assert.ok(Number.isSafeInteger(originalPid) && originalPid > 0, 'Original GUI PID required')
  assert.equal(record?.rootPid, originalPid, 'Outcome must come from the original GUI pipe')
  const state = record.desktop_session_outcome
  assert.equal(state?.schema, 1)
  for (const key of ['bootComplete', 'rendererReady', 'quitRequested', 'cleanupChecked', 'cleanupVerified',
    'ownershipChecked', 'ownershipReleased', 'failed', 'successfulSession', 'guardianReleaseAuthorized'])
    assert.equal(typeof state[key], 'boolean', `Missing boolean ${key}`)
  assert.equal(state.quitRequested, true)
  assert.equal(state.cleanupChecked, true)
  assert.equal(state.cleanupVerified, true)
  assert.equal(state.ownershipChecked, true)
  assert.equal(state.ownershipReleased, true)
  assert.equal(state.guardianReleaseAuthorized, false)
  assert.ok(Array.isArray(state.failures) && state.failures.length <= 10 &&
    state.failures.every(code => FAILURE_CODES.includes(code)) &&
    new Set(state.failures).size === state.failures.length, 'Bounded unique failure codes required')
  if (mode === 'normal') {
    assert.equal(state.outcome, 'clean'); assert.equal(state.successfulSession, true)
    assert.equal(state.failed, false); assert.deepEqual(state.failures, [])
    assert.equal(state.recommendedExitCode, 0)
    assert.equal(state.bootComplete, true); assert.equal(state.rendererReady, true)
  } else {
    assert.equal(state.outcome, 'failed'); assert.equal(state.successfulSession, false)
    assert.equal(state.failed, true); assert.equal(state.recommendedExitCode, 1)
    assert.ok(state.failures.includes(mode === 'startup-failure' ? 'startup-failed' : 'native-service-exited'))
    assert.equal(state.bootComplete, mode === 'native-exit')
    assert.equal(state.rendererReady, mode === 'native-exit')
  }
  return state
}

async function freePort() {
  const server = createNetServer()
  await new Promise((done, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', done) })
  const port = server.address().port
  await new Promise(done => server.close(done))
  return port
}
function boundedJson(file) {
  const info = lstatSync(file)
  assert.ok(info.isFile() && !info.isSymbolicLink() && info.size <= 65536, 'Bounded fixture JSON required')
  const bytes = readFileSync(file)
  assert.ok(bytes.length <= 65536, 'Fixture JSON grew past bound')
  return JSON.parse(bytes.toString('utf8'))
}

async function run(mode) {
  const started = Date.now(), sourceSha256 = measure()
  const layoutRoot = mkdtempSync(join(root, 'verification/.native-browser-migration-session-outcome-'))
  const paths = { layoutRoot, desktop: join(layoutRoot, 'state/private/desktop'),
    core: join(layoutRoot, 'state/private/core'), browser: join(layoutRoot, 'state/browser'),
    privateRoot: join(layoutRoot, 'state/private'), temp: join(layoutRoot, 'state/private/tmp') }
  const ownerKey = randomBytes(48).toString('base64url')
  let heartbeatCount = 0, ownerClosed = false, child, exitResult, outcome, parseError, line = '', droppingLine = false
  let diagnostic = '', forced = false, readiness
  const owner = createHttpServer({ maxHeaderSize: 4096 }, (request, response) => {
    const valid = !ownerClosed && request.method === 'GET' && request.url === '/owner' &&
      request.headers.authorization === `Bearer ${ownerKey}`
    if (valid) heartbeatCount++
    response.writeHead(valid ? 200 : 403, { Connection: 'close' }); response.end()
  })
  owner.requestTimeout = 1000; owner.headersTimeout = 1000
  const closeOwner = () => { if (!ownerClosed) { ownerClosed = true; owner.close(); owner.closeAllConnections() } }
  const awaitExit = async (ms, allowForce = false) => {
    const deadline = Date.now() + ms
    while (!exitResult && Date.now() < deadline) await wait(25)
    if (!exitResult && allowForce) { forced = true; child.kill(); await wait(2000) }
    assert.ok(exitResult, 'Original GUI exit deadline; no descendant drain claim')
  }
  try {
  await new Promise((done, reject) => { owner.once('error', reject); owner.listen(0, '127.0.0.1', done) })
  const [desktopPort, bridgePort] = await Promise.all([freePort(), freePort()])
  assert.notEqual(desktopPort, bridgePort)
  const environment = packagedProbeEnvironment(process.env, paths, { desktopPort, bridgePort,
    ownerUrl: `http://127.0.0.1:${owner.address().port}/owner`, ownerKey })
  const powershell = join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe')
  const tool = (name, args, env = environment) => {
    const result = spawnSync(powershell, ['-NoProfile', '-File', join(desktopRoot, 'scripts', name), ...args],
      { env, encoding: 'utf8', windowsHide: true, shell: false, timeout: 30000, maxBuffer: 65536 })
    assert.ok(!result.error && result.status === 0, `Fixture permission helper ${name} failed; state preserved`)
  }
  const verifyAcl = () => {
    tool('verify-private-state-acl.ps1', ['-Root', paths.privateRoot])
    tool('verify-browser-state-acl.ps1', ['-Root', paths.browser])
  }
  const retain = bytes => { diagnostic = (diagnostic + bytes.toString('utf8')).slice(-4096) }
  const parse = bytes => {
    retain(bytes)
    for (const char of bytes.toString('utf8')) {
      if (char === '\n') {
        if (!droppingLine && line.startsWith('{') && line.includes('desktop_session_outcome')) {
          try {
            assert.equal(outcome, undefined, 'Duplicate original GUI outcome')
            outcome = JSON.parse(line)
          } catch { parseError = 'Invalid or duplicated GUI outcome' }
        }
        line = ''; droppingLine = false
      } else if (!droppingLine) {
        if (line.length >= 4096) { line = ''; droppingLine = true }
        else line += char
      }
    }
  }
    for (const storageClass of ['private', 'browser']) tool('provision-private-state.ps1',
      ['-Root', layoutRoot, '-StorageClass', storageClass, '-Apply'], packagedProvisionEnvironment(environment, paths))
    for (const dir of [paths.desktop, paths.core, paths.temp]) mkdirSync(dir)
    verifyAcl()
    if (mode === 'startup-failure') environment.NORI_RUNTIME_PYTHON = join(paths.temp, 'missing-python.exe')
    const args = [desktopRoot, '--workspace-probe', '--consolidated-layout-probe',
      ...(mode === 'native-exit' ? ['--native-exit-probe'] : [])]
    child = spawn(join(root, 'runtime/electron/v44.4.5/electron.exe'), args,
      { cwd: root, env: environment, windowsHide: true, shell: false, stdio: ['pipe', 'pipe', 'pipe'] })
    child.once('exit', (code, signal) => { exitResult = { code, signal } })
    child.once('error', error => { exitResult = { error: error.code || 'SPAWN_ERROR' } })
    child.stdin.on('error', () => {})
    child.stdout.on('data', parse); child.stderr.on('data', retain)
    const readyPath = join(paths.desktop, 'desktop-readiness.json'), failurePath = join(paths.desktop, 'desktop-failure.json')
    if (mode !== 'startup-failure') {
      const deadline = Date.now() + 60000
      while (!existsSync(readyPath)) {
        assert.ok(!exitResult && !existsSync(failurePath), 'Actual GUI failed before readiness')
        assert.ok(Date.now() < deadline, 'Actual GUI readiness deadline')
        await wait(25)
      }
      readiness = validatePackagedReadiness(boundedJson(readyPath), paths, bridgePort)
      if (mode === 'normal') {
        const heartbeatDeadline = Date.now() + 3000
        while (!heartbeatCount) {
          assert.ok(!exitResult && Date.now() < heartbeatDeadline, 'Original GUI heartbeat deadline')
          await wait(25)
        }
        closeOwner()
      }
      // Fault mode keeps its heartbeat live. Only the GUI's own exact runtime
      // stop fault may request failure; the caller does NOT initiate a quit.
    }
    await awaitExit(40000)
    const pipeDeadline = Date.now() + 2000
    while (!outcome && Date.now() < pipeDeadline) await wait(10)
    assert.equal(parseError, undefined)
    const sessionOutcome = validateSessionOutcome(outcome, mode, child.pid)
    assert.equal(exitResult.code, mode === 'normal' ? 0 : 1)
    assert.equal(exitResult.signal, null)
    assert.equal(forced, false)
    const ordinaryOwnershipReleased = Object.fromEntries(['desktop', 'browser', 'core'].map(role =>
      [role, !existsSync(join(paths[role], '.nori-state-owner.json'))]))
    assert.ok(Object.values(ordinaryOwnershipReleased).every(Boolean))
    if (mode === 'startup-failure') {
      assert.equal(existsSync(readyPath), false)
      assert.ok(existsSync(failurePath))
      boundedJson(failurePath)
    } else assert.ok(heartbeatCount > 0)
    verifyAcl()
    assert.deepEqual(measure(), sourceSha256, 'Candidate sources changed during live probe')
    const receiptPath = join(paths.desktop, 'desktop-session-outcome-receipt.json')
    const receipt = { schema: 1, desktopSessionOutcomeProbe: 'PASS', mode, syntheticOnly: true,
      originalGuiPid: child.pid, originalGuiExit: exitResult, guiForced: forced,
      sessionOutcome, actualReadiness: readiness, sourceSha256, ordinaryOwnershipReleased,
      heartbeatCount, authenticatedHeartbeatObserved: heartbeatCount > 0,
      privateAclVerifiedBeforeAndAfter: true, browserAclVerifiedBeforeAndAfter: true,
      generatedLayoutRoot: layoutRoot, elapsedMilliseconds: Date.now() - started,
      exactDescendantDrainVerified: false, productionGuardianVerified: false,
      installedAcceptanceVerified: false, releaseVerified: false }
    writeFileSync(receiptPath, JSON.stringify(receipt, null, 2) + '\n', { flag: 'wx' })
    console.log(JSON.stringify({ desktopSessionOutcomeProbe: 'PASS', mode, receipt: receiptPath, guiExit: exitResult.code }))
    return receiptPath
  } catch (error) {
    closeOwner()
    if (child && !exitResult) { try { await awaitExit(40000, true) } catch { /* Preserve failed state. */ } }
    const failure = { schema: 1, desktopSessionOutcomeProbe: 'FAIL', mode, error: error.message,
      originalGuiExit: exitResult, outcome, guiForced: forced, generatedLayoutRoot: layoutRoot,
      diagnosticTail: diagnostic.split(ownerKey).join('[private-owner-key]'), sourceSha256,
      exactDescendantDrainVerified: false, productionGuardianVerified: false }
    if (existsSync(paths.desktop)) writeFileSync(join(paths.desktop, 'desktop-session-outcome-failure.json'),
      JSON.stringify(failure, null, 2) + '\n', { flag: 'wx' })
    throw Error(`Session outcome ${mode} failed: ${error.message}; preserved ${layoutRoot}`)
  } finally {
    closeOwner()
    if (child) { child.stdin.destroy(); child.stdout.destroy(); child.stderr.destroy(); child.unref() }
  }
}

async function main() {
  assert.equal(process.platform, 'win32', 'Real session outcome probes require Windows')
  assert.equal(process.argv.length, 2, 'Source session outcome probe accepts no state paths or arguments')
  for (const mode of modes) await run(mode)
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url)
  void main().catch(error => { console.error(error.message); process.exitCode = 1 })
