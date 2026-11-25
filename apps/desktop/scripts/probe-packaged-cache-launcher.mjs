// Source harness; the tested process uses only its own packaged components.
import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
import {createRequire} from 'node:module'
import {existsSync, readFileSync, writeFileSync} from 'node:fs'
import {join, resolve} from 'node:path'
import {spawnSync} from 'node:child_process'
import {packagedProbeOptions} from './packaged-probe-options.mjs'
const {extractFile} = createRequire(import.meta.url)('@electron/asar')
const root = resolve(import.meta.dirname, '../../..')
const options = packagedProbeOptions(process.argv.slice(2), 'launcher')
const candidate = join(root, `apps/desktop/release/native-desktop-${options.candidate}`)
const packageRoot = join(candidate, 'win-unpacked')
const output = join(root, 'verification', options.evidence)
if (existsSync(output)) throw Error('Existing packaged launcher evidence preserved')
const hash = bytes => createHash('sha256').update(bytes).digest('hex')
const receiptFile = join(candidate, 'native-desktop-receipt.json')
const receiptBytes = readFileSync(receiptFile)
const receipt = JSON.parse(receiptBytes)
assert.equal(receipt.packagedPayloadMatches, true)
assert.equal(receipt.candidate, options.candidate)
const launcherPath = 'apps/desktop/desktop/native-service.cjs'
// Preserve the historical default's exact source qualification. Fresh explicit
// candidates instead bind to their own manifest, then qualify behavior below.
const historical = process.argv.slice(2).length === 0
const launcherHash = historical
  ? JSON.parse(readFileSync(join(root, 'verification/nori-cache-desktop-launcher-2026-10-05.json'), 'utf8')).sourceHashes[launcherPath]
  : receipt.nativeManifest.files.find(file => file.path === launcherPath)?.sha256
assert.match(launcherHash ?? '', /^[a-f0-9]{64}$/i, 'Candidate launcher binding missing')
const archiveLauncher = extractFile(join(packageRoot, 'resources/app.asar'), ['desktop', 'native-service.cjs'].join(process.platform === 'win32' ? '\\' : '/'))
assert.equal(hash(archiveLauncher), launcherHash, 'Packaged Electron launcher differs from exact evidence binding')
assert.equal(hash(readFileSync(join(packageRoot, 'resources/NoriSuite/apps/desktop/desktop/native-service.cjs'))), launcherHash)
const clean = Object.fromEntries(Object.entries(process.env).filter(([name]) =>
  !/^(?:NORI_|NODE|PYTHON|ELECTRON_|NPM_|PIP_|CONDA_|UV_|PATH$|VIRTUAL_ENV$)/i.test(name)))
const systemRoot = process.env.SystemRoot
assert.ok(systemRoot)
clean.PATH = [join(systemRoot, 'System32'), systemRoot, join(systemRoot, 'System32/Wbem')].join(';')
clean.ELECTRON_RUN_AS_NODE = '1'
const code = `
const assert=require('node:assert/strict'),{join}=require('node:path'),{pathToFileURL}=require('node:url');
const packageRoot=process.argv[1],suite=join(packageRoot,'resources/NoriSuite');
const {startNativeService}=require(join(suite,'apps/desktop/desktop/native-service.cjs'));
(async()=>{let service;try{
 const {nativeRuntimeChat}=await import(pathToFileURL(join(suite,'apps/desktop/bridge/native-runtime.mjs')).href);
 service=await startNativeService({root:suite,environment:process.env});
 assert.equal(service.status.cachePrecision,'f32');
 assert.equal(service.child.spawnfile.toLowerCase(),join(suite,'python/Python311/python.exe').toLowerCase());
 const env=service.environment;let reply='';
 for await(const text of nativeRuntimeChat({endpoint:env.NORI_RUNTIME_URL,apiKey:env.NORI_RUNTIME_API_KEY,
 modelId:env.NORI_RUNTIME_MODEL_ID,messages:[{role:'user',content:'Say hello.'}],maxTokens:4}))reply+=text;
 assert.equal(reply,'Hello!');await service.stop();const exit=await service.exited;assert.equal(exit.code,0);
 console.log(JSON.stringify({passed:true,status:service.status,reply,runtimeExit:exit,bundledPython:true}));
 }finally{if(service)await service.stop()}})().catch(error=>{console.error(error.message);process.exitCode=1});
`
const report = {schema: 'nori.cache-packaged-launcher.v1', passed: false,
  launcherBinding: historical ? 'historical-source-qualification' : 'candidate-native-manifest',
  candidate: options.candidate, receiptSha256: hash(receiptBytes), launcherSha256: launcherHash,
  releaseVerified: false, installedSuiteVerified: false,
  limits: ['Packaged executable in Node mode, actual packaged launcher/Python/worker and desktop streaming client.',
    'No GUI, installer, private profile, sensor or durable tool acceptance; production configuration remains F32.']}
try {
  // Check the actual entire package before executing its native service.
  // This uses the shipped executable/verifier, not a current-source substitute.
  const verification = spawnSync(join(packageRoot, 'Nori.exe'),
    [join(packageRoot, 'backup-tools/verify-portable-native.mjs'), packageRoot, receiptFile],
    {cwd: packageRoot, env: clean, shell: false, windowsHide: true, encoding: 'utf8', timeout: 180000, maxBuffer: 65536})
  assert.equal(verification.status, 0, verification.stderr || verification.error?.message || 'Packaged integrity failed')
  report.packageIntegrity = JSON.parse(verification.stdout.trim())
  assert.equal(report.packageIntegrity.desktopIntegrityVerified, true)
  assert.equal(report.packageIntegrity.payloadIntegrityVerified, true)
  assert.equal(report.packageIntegrity.sourceTreeRequired, false)
  assert.equal(hash(readFileSync(receiptFile)), report.receiptSha256)
  const probe = spawnSync(join(packageRoot, 'Nori.exe'), ['-e', code, packageRoot],
    {cwd: packageRoot, env: clean, shell: false, windowsHide: true, encoding: 'utf8', timeout: 45000, maxBuffer: 65536})
  assert.equal(probe.status, 0, probe.stderr || probe.error?.message || 'Packaged launcher failed')
  const result = JSON.parse(probe.stdout.trim())
  assert.equal(result.passed, true)
  report.result = result
  const pids = [result.status.workerPid, result.status.runtimePid]
  assert.ok(pids.every(pid => Number.isSafeInteger(pid) && pid > 0))
  const filter = pids.map(pid => `ProcessId = ${pid}`).join(' OR ')
  const check = spawnSync(join(systemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe'),
    ['-NoProfile', '-Command', `if (Get-CimInstance Win32_Process -Filter '${filter}') { exit 1 } else { exit 0 }`],
    {shell: false, windowsHide: true, encoding: 'utf8', timeout: 10000})
  assert.equal(check.status, 0, 'Packaged owned worker survived shutdown')
  assert.equal(hash(readFileSync(receiptFile)), report.receiptSha256)
  report.ownedWorkerAbsent = true
  report.ownedRuntimeAbsent = true
  report.passed = true
} catch (error) {
  report.failure = {type: error.name, message: error.message}
  throw error
} finally {
  writeFileSync(output, JSON.stringify(report, null, 2) + '\n', {flag: 'wx'})
}
console.log(JSON.stringify({passed: true, packagedLauncher: true, systemPythonOrNodeRequired: false,
  ownedWorkerAbsent: true, installedSuiteVerified: false, releaseVerified: false}))
