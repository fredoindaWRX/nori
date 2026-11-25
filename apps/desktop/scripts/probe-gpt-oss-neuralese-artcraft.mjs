import { createRequire } from 'node:module'
import { existsSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { localChat } from '../bridge/local-chat.mjs'

const require = createRequire(import.meta.url)
const { startGptOssService } = require('../desktop/gpt-oss-service.cjs')
const noriRoot = 'C:\\Nori'
const workspaceRoot = mkdtempSync(path.join(os.tmpdir(), 'nori-gptoss-neuralese-artcraft-'))
const verificationRoot = path.resolve(process.cwd(), 'verification')
const receiptPath = path.join(verificationRoot, `gpt-oss-neuralese-artcraft-${Date.now()}.json`)
const environmentNames = ['NORI_GPT_OSS_ENABLED', 'NORI_GPT_OSS_URL', 'NORI_GPT_OSS_SERVER_MODEL',
  'NORI_INFERENCE_RUNTIME', 'NORI_ROOT', 'NORI_APP_DATA_ROOT', 'NORI_GPT_OSS_CONTEXT_TOKENS']
const previousEnvironment = Object.fromEntries(environmentNames.map(name => [name, process.env[name]]))
let service
const receipt = {
  schema: 'nori.verification.gpt-oss-neuralese-artcraft.v1',
  result: 'FAIL',
  syntheticOnly: true,
  gptOssModelSha256: '52f57ab7d3df3ba9173827c1c6832e73375553a846f3e32b49f1ae2daad688d4',
  neuralesePlannerToolOnly: true,
  noOllamaFallback: true,
  noCloudInference: true,
  uiOrWebSocketPathVerified: false,
  artifactExistsBeforeCleanup: false,
  artifactBytes: 0,
  runtimeStopped: false,
  workspaceRemoved: false,
}

try {
  process.env.NORI_GPT_OSS_ENABLED = '1'
  process.env.NORI_GPT_OSS_SERVER_MODEL = 'gpt-oss-20b'
  process.env.NORI_GPT_OSS_CONTEXT_TOKENS = '4096'
  process.env.NORI_INFERENCE_RUNTIME = 'gpt-oss'
  process.env.NORI_ROOT = noriRoot
  process.env.NORI_APP_DATA_ROOT = workspaceRoot

  service = await startGptOssService({ root: noriRoot, contextTokens: 4096 })
  process.env.NORI_GPT_OSS_URL = service.endpoint
  receipt.model = service.status

  const filename = 'nori-gpt-oss-live.svg'
  const goal = `Use VectorCraft to create a 240x160 SVG with a dark blue rectangle and gold circle, and save it as ${filename}.`
  const response = []
  for await (const part of localChat({ goal, turns: [], profile: 'balanced', modelSelection: 'gpt-oss:20b' })) {
    response.push(String(part))
  }
  const artifact = path.join(workspaceRoot, 'integrations', 'artcraft', 'workspaces',
    'app-sandboxes', 'vectorcraft', 'outputs', filename)
  receipt.artifactExistsBeforeCleanup = existsSync(artifact) && statSync(artifact).isFile()
  receipt.artifactBytes = receipt.artifactExistsBeforeCleanup ? statSync(artifact).size : 0
  if (!receipt.artifactExistsBeforeCleanup || receipt.artifactBytes < 1) {
    throw new Error(`The live GPT-OSS turn did not create the exact requested VectorCraft output. Response: ${response.join('\n').slice(-1800)}`)
  }
  receipt.result = 'PASS'
  receipt.responseTail = response.join('\n').slice(-1200)
} catch (error) {
  receipt.error = String(error?.stack ?? error).slice(0, 4000)
} finally {
  const artifact = path.join(workspaceRoot, 'integrations', 'artcraft', 'workspaces',
    'app-sandboxes', 'vectorcraft', 'outputs', 'nori-gpt-oss-live.svg')
  try {
    receipt.artifactExistsBeforeCleanup = existsSync(artifact) && statSync(artifact).isFile()
    receipt.artifactBytes = receipt.artifactExistsBeforeCleanup ? statSync(artifact).size : 0
  } catch { /* preserve cleanup and report no verifiable artifact */ }
  if (service) {
    try { await service.stop(); receipt.runtimeStopped = true }
    catch (error) { receipt.cleanupError = String(error?.message ?? error).slice(0, 1000) }
  }
  for (const name of environmentNames) {
    if (previousEnvironment[name] === undefined) delete process.env[name]
    else process.env[name] = previousEnvironment[name]
  }
  rmSync(workspaceRoot, { recursive: true, force: true })
  receipt.workspaceRemoved = !existsSync(workspaceRoot)
  mkdirSync(verificationRoot, { recursive: true })
  writeFileSync(receiptPath, JSON.stringify(receipt, null, 2) + '\n', { flag: 'wx' })
}

console.log(JSON.stringify({ receipt: receiptPath, ...receipt }))
if (receipt.result !== 'PASS' || !receipt.runtimeStopped || !receipt.workspaceRemoved) process.exitCode = 1
