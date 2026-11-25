import { createRequire } from 'node:module'
import { existsSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const suiteRoot = path.join(process.resourcesPath, 'NoriSuite')
const archiveRoot = pathToFileURL(path.join(process.resourcesPath, 'app.asar')).href
const sourceBridge = process.env.NORI_PROBE_SOURCE_BRIDGE === '1'
const bridgeRoot = sourceBridge ? path.resolve(process.cwd(), 'apps', 'desktop', 'bridge') : null
const appRequire = createRequire(pathToFileURL(path.join(process.resourcesPath, 'app.asar', 'desktop', 'main.cjs')))
const { startNativeService } = appRequire('./native-service.cjs')
const [{ localChat }, { nativeRuntimeChat }, { byteFraming, byteCount }] = await Promise.all([
  import(sourceBridge ? pathToFileURL(path.join(bridgeRoot, 'local-chat.mjs')).href : `${archiveRoot}/bridge/local-chat.mjs`),
  import(`${archiveRoot}/bridge/native-runtime.mjs`),
  import(`${archiveRoot}/bridge/context-budget.mjs`),
])
const workspaceRoot = mkdtempSync(path.join(os.tmpdir(), 'nori-packaged-artcraft-chat-'))
const verificationRoot = path.resolve(process.cwd(), 'verification')
const receiptPath = path.join(verificationRoot, `artcraft-packaged-live-model-smoke-${Date.now()}.json`)
const environmentNames = [
  'NORI_INFERENCE_RUNTIME', 'NORI_RUNTIME_MODEL_ID', 'NORI_RUNTIME_MODEL_STATE',
  'NORI_RUNTIME_URL', 'NORI_RUNTIME_API_KEY', 'NORI_RUNTIME_CONFIG_PATH',
  'NORI_ROOT', 'NORI_APP_DATA_ROOT', 'NORI_LOCAL_CHAT',
]
const previousEnvironment = Object.fromEntries(environmentNames.map(name => [name, process.env[name]]))
let runtime
let receipt = {
  schema: 'nori.verification.artcraft-packaged-live-model-smoke.v1',
  candidateRoot: process.resourcesPath,
  result: 'FAIL',
  bridgeSource: sourceBridge ? 'source checkout; candidate runtime and tool packages' : 'candidate app.asar',
  syntheticOnly: true,
  modelPlanWasSynthetic: false,
  uiOrWebSocketPathVerified: false,
  liveModelGenerationVerified: false,
  artifactCreated: false,
  workspaceRemoved: false,
}

try {
  process.env.NORI_ROOT = suiteRoot
  process.env.NORI_APP_DATA_ROOT = workspaceRoot
  process.env.NORI_LOCAL_CHAT = '1'
  console.log(JSON.stringify({ probe: 'packaged-artcraft-chat', state: 'starting-runtime', suiteRoot }))
  runtime = await startNativeService({ root: suiteRoot, environment: process.env })
  Object.assign(process.env, runtime.environment)
  receipt.runtime = runtime.status

  const filename = 'nori-packaged-live-model-smoke.svg'
  const goal = `Use VectorCraft to create a 240x160 SVG with a dark blue rectangle and gold circle, and save it as ${filename}. Return valid SVG markup.`
  const output = []
  for await (const part of localChat({
    goal,
    turns: [],
    profile: 'balanced',
    modelSelection: runtime.status.modelId,
    nativeCounter: async () => ({ framing: byteFraming(), countContent: byteCount }),
    nativeChatGenerator: async function* (request) {
      let raw = ''
      for await (const token of nativeRuntimeChat(request)) {
        raw += token
        yield token
      }
      receipt.modelOutputPreview = raw.slice(0, 4000)
    },
  })) output.push(String(part))

  const artifact = path.join(workspaceRoot, 'integrations', 'artcraft', 'workspaces',
    'app-sandboxes', 'vectorcraft', 'outputs', filename)
  if (!existsSync(artifact) || !statSync(artifact).isFile() || statSync(artifact).size < 1) {
    throw new Error(`Packaged live-model ArtCraft request did not save the expected VectorCraft output. Result: ${output.join('\n').slice(-2000)}`)
  }
  receipt = { ...receipt, result: 'PASS', liveModelGenerationVerified: true,
    artifactCreated: true, artifactBytes: statSync(artifact).size,
    neuraleseReceiptObserved: output.some(text => text.includes('Neuralese-validated action')),
    responseTail: output.join('\n').slice(-1200) }
} catch (error) {
  receipt = { ...receipt, result: 'FAIL', error: String(error?.stack ?? error).slice(0, 4000) }
  throw error
} finally {
  if (runtime) {
    try { await runtime.stop(); receipt.runtimeStopped = true }
    catch (error) { receipt.runtimeStopped = false; receipt.cleanupError = String(error?.message ?? error).slice(0, 1000) }
  } else receipt.runtimeStopped = true
  for (const name of environmentNames) {
    if (previousEnvironment[name] === undefined) delete process.env[name]
    else process.env[name] = previousEnvironment[name]
  }
  rmSync(workspaceRoot, { recursive: true, force: true })
  receipt.workspaceRemoved = !existsSync(workspaceRoot)
  mkdirSync(verificationRoot, { recursive: true })
  writeFileSync(receiptPath, JSON.stringify(receipt, null, 2) + '\n', { flag: 'wx' })
  console.log(JSON.stringify({ probe: 'packaged-artcraft-chat', receipt: receiptPath, ...receipt }))
}
