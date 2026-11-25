// Real source launcher acceptance. No app/config replacement, sensors or tools.
import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
import {createReadStream, existsSync, readFileSync, writeFileSync} from 'node:fs'
import {join, resolve} from 'node:path'
import {createRequire} from 'node:module'
import {spawnSync} from 'node:child_process'
import {nativeRuntimeChat} from '../bridge/native-runtime.mjs'
const {startNativeService} = createRequire(import.meta.url)('../desktop/native-service.cjs')
const root = resolve(import.meta.dirname, '../../..')
const output = join(root, 'verification/nori-cache-desktop-launcher-2026-10-05.json')
if (existsSync(output)) throw Error('Existing launcher evidence preserved')
const hash = async file => {
  const digest = createHash('sha256')
  for await (const chunk of createReadStream(file)) digest.update(chunk)
  return digest.digest('hex')
}
const config = JSON.parse(readFileSync(join(root, 'runtime/norllama/config.json'), 'utf8'))
const files = ['apps/desktop/scripts/probe-native-cache-launcher.mjs',
  'apps/desktop/desktop/native-service.cjs', 'apps/desktop/bridge/native-runtime.mjs',
  'apps/desktop/bridge/local-policy.mjs', 'runtime/norllama/config.json',
  'runtime/norllama/norllama.py', 'runtime/norllama/contract_grammar.py',
  'runtime/norllama/structured_output.py', config.engine_binary, config.model_path,
  'python/Python311/python.exe']
const bindings = Object.fromEntries(await Promise.all(files.map(async name => [name, await hash(join(root, name))])))
assert.equal(bindings[config.model_path], 'dde5aa3fc5ffc17176b5e8bdc82f587b24b2678c6c66101bf7da77af9f7ccdff')
const report = {schema: 'nori.cache-desktop-launcher.v1', passed: false, sourceHashes: bindings,
  productionConfigChanged: false, productionWorkerChanged: false, releaseVerified: false,
  limits: ['Real source desktop launcher, bundled Python, production F32 worker and real GPU streaming client.',
    'No installed GUI/package qualification or activation; FP16 candidate not promoted.',
    'No sensors, Core tool dispatch, private state migration, training or teacher/eval access.']}
let service
try {
  service = await startNativeService({root, environment: process.env})
  assert.equal(service.status.cachePrecision, config.cache_precision ?? 'f32')
  report.status = service.status
  const environment = service.environment
  let reply = ''
  for await (const text of nativeRuntimeChat({endpoint: environment.NORI_RUNTIME_URL,
    apiKey: environment.NORI_RUNTIME_API_KEY, modelId: environment.NORI_RUNTIME_MODEL_ID,
    messages: [{role: 'user', content: 'Say hello.'}], maxTokens: 4})) reply += text
  assert.equal(reply, 'Hello!')
  report.reply = reply
  await service.stop()
  report.runtimeExit = await service.exited
  assert.equal(report.runtimeExit.code, 0)
  assert.equal(report.runtimeExit.exitSignal, null)
  // Check only the exact observed owned worker identity, never kill by name.
  const systemRoot = process.env.SystemRoot
  assert.ok(systemRoot)
  const check = spawnSync(join(systemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe'),
    ['-NoProfile', '-Command', `if (Get-CimInstance Win32_Process -Filter "ProcessId = ${service.status.workerPid}") { exit 1 } else { exit 0 }`],
    {windowsHide: true, shell: false, encoding: 'utf8', timeout: 10000})
  assert.equal(check.status, 0, 'Owned worker still exists after runtime shutdown')
  report.ownedWorkerAbsent = true
  for (const [name, expected] of Object.entries(bindings)) assert.equal(await hash(join(root, name)), expected, name)
  report.inputsUnchanged = true
  report.passed = true
} catch (error) {
  report.failure = {type: error.name, message: error.message}
  throw error
} finally {
  if (service) await service.stop()
  writeFileSync(output, JSON.stringify(report, null, 2) + '\n', {flag: 'wx'})
}
console.log(JSON.stringify({passed: report.passed, cachePrecision: report.status.cachePrecision,
  reply: report.reply, ownedWorkerAbsent: report.ownedWorkerAbsent, releaseVerified: false}))
