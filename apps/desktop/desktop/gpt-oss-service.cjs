// Optional, explicitly selected local GPT-OSS inference service. This is an
// imported checkpoint service, not Norama/SoN and never a fallback runtime.
const { spawn } = require('node:child_process')
const { createServer } = require('node:net')
const { createHash } = require('node:crypto')
const { lstatSync, realpathSync, openSync, fstatSync, closeSync, readFileSync, readSync } = require('node:fs')
const { resolve, relative, isAbsolute, join } = require('node:path')
const { startNoriLocalAgentProvider } = require('./nori-local-agent-provider.cjs')
const { importedModelProfile } = require('./imported-model-profile.cjs')

const MODEL_RELATIVE = 'models/language/gpt-oss-20b-ggmlorg-mxfp4-a7443ebb/gpt-oss-20b-mxfp4.gguf'
const SERVER_RELATIVE = 'engine/gpt-oss-runtime/build/bin/llama-server.exe'
const HERETIC_ADAPTER_RELATIVE = 'models/candidates/heretic-gptoss20b-mxfp4-20261013/heretic-adapter-f16.gguf'
const HERETIC_ADAPTER_SHA256 = 'c7c57ea709634767842b21d8a37dfb875f4421d7a71f84023e2a2ee03e927e62'
const MODEL_MIN_BYTES = 10 * 1024 ** 3
const MODEL_MAX_BYTES = 32 * 1024 ** 3
// llama-server.exe is a small launcher; its implementation and CUDA backend
// are adjacent DLLs from the same separately built, pinned runtime.
const SERVER_MIN_BYTES = 8 * 1024
const SERVER_MAX_BYTES = 512 * 1024 ** 2
const RUNTIME_FILES = [
  ['engine/gpt-oss-runtime/build/bin/ggml-base.dll', 64 * 1024],
  ['engine/gpt-oss-runtime/build/bin/ggml-cpu.dll', 64 * 1024],
  ['engine/gpt-oss-runtime/build/bin/ggml-cuda.dll', 1024 * 1024],
  ['engine/gpt-oss-runtime/build/bin/ggml.dll', 64 * 1024],
  ['engine/gpt-oss-runtime/build/bin/llama-common.dll', 64 * 1024],
  ['engine/gpt-oss-runtime/build/bin/llama-server-impl.dll', 64 * 1024],
  ['engine/gpt-oss-runtime/build/bin/llama.dll', 64 * 1024],
  ['engine/gpt-oss-runtime/build/bin/mtmd.dll', 64 * 1024],
  // Required by ggml-cuda, not optional host CUDA Toolkit dependencies. Keeping
  // these in the same inventory also makes nativePayloadPlan package them.
  ['engine/gpt-oss-runtime/build/bin/cublas64_13.dll', 1024 * 1024],
  ['engine/gpt-oss-runtime/build/bin/cublasLt64_13.dll', 1024 * 1024],
  ['engine/gpt-oss-runtime/build/bin/NVIDIA-CUDA-EULA.txt', 64],
]
const PORT = 18788
// A conservative 8-layer profile leaves extra headroom for Nori's spatial
// renderer and other Windows GPU clients on a 16 GiB card.
const GPU_LAYERS = 8
// GPT-OSS may need extra time on a cold Windows/CUDA start (kernel and model
// initialization). Keep waiting for the explicit health check rather than
// killing a still-starting local server at the former 30 second cutoff.
const STARTUP_TIMEOUT_MS = 90_000
const SUPPORTED_CONTEXT_TOKENS = Object.freeze([4096, 8192, 16384, 32768, 65536, 78000, 196608])

function resolveGptOssContextTokens(value) {
  if (value === undefined || value === '') return 78000
  const parsed = Number(value)
  if (!SUPPORTED_CONTEXT_TOKENS.includes(parsed)) throw new RangeError('Unsupported GPT-OSS context profile')
  return parsed
}

function safeFile(root, name, minBytes, maxBytes, inspector = lstatSync, resolver = realpathSync) {
  const expected = resolve(root, name)
  if (!relative(root, expected) || relative(root, expected).startsWith('..') || isAbsolute(relative(root, expected)))
    throw new Error('GPT-OSS component escapes the Nori root')
  // Check every path component below Nori. Reparse/symlink components are not
  // followed, even when their destination would remain inside the workspace.
  let current = root
  const parts = relative(root, expected).split(/[\\/]/)
  for (const [index, part] of parts.entries()) {
    current = join(current, part)
    const item = inspector(current)
    if (item.isSymbolicLink() || (index === parts.length - 1 ? !item.isFile() : !item.isDirectory()))
      throw new Error('GPT-OSS component contains a reparse point or unexpected file type')
  }
  const actual = resolver(expected)
  if (actual.toLowerCase() !== expected.toLowerCase()) throw new Error('GPT-OSS component resolves outside its pinned path')
  const stat = inspector(expected)
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size < minBytes || stat.size > maxBytes || (stat.nlink > 1))
    throw new Error('GPT-OSS component identity or size is not qualified')
  return { path: expected, size: stat.size, dev: stat.dev, ino: stat.ino,
    mtimeMs: stat.mtimeMs, ctimeMs: stat.ctimeMs }
}

function identityStillMatches(expected, actual) {
  return actual.isFile() && !actual.isSymbolicLink() && actual.size === expected.size &&
    actual.dev === expected.dev && actual.ino === expected.ino &&
    actual.mtimeMs === expected.mtimeMs && actual.ctimeMs === expected.ctimeMs && actual.nlink <= 1
}

function assertLoopbackPortFree(port = PORT) {
  return new Promise((resolvePort, rejectPort) => {
    const server = createServer()
    server.once('error', rejectPort)
    server.listen(port, '127.0.0.1', () => server.close(error => error ? rejectPort(error) : resolvePort()))
  })
}

function gptOssLaunchPaths(root, { inspector = lstatSync, resolver = realpathSync,
  opener = openSync, fstat = fstatSync, closer = closeSync, allowTestRoot = false } = {},
{ hereticAdapter = false, expectedAdapterSha256 = HERETIC_ADAPTER_SHA256, modelProfile = 'gpt-oss-20b' } = {}) {
  const profile = importedModelProfile(modelProfile)
  if (hereticAdapter && profile.id !== 'gpt-oss-20b') throw new Error('GPT-OSS adapter is incompatible with the selected model')
  root = resolve(root)
  const rootStat=inspector(root)
  if(!rootStat.isDirectory()||rootStat.isSymbolicLink()||resolver(root).toLowerCase()!==root.toLowerCase())
    throw new Error('GPT-OSS suite root must be a physical Nori installation directory')
  const modelRoot = profile.modelStoreRoot ? resolve(profile.modelStoreRoot) : root
  const modelRootStat = inspector(modelRoot)
  if (!modelRootStat.isDirectory() || modelRootStat.isSymbolicLink() || resolver(modelRoot).toLowerCase() !== modelRoot.toLowerCase())
    throw new Error('Owned model store must be a physical directory')
  const model = safeFile(modelRoot, profile.relativePath, profile.bytes || MODEL_MIN_BYTES,
    profile.bytes || MODEL_MAX_BYTES, inspector, resolver)
  if (profile.bytes && model.size !== profile.bytes) throw new Error('Selected model size does not match its pinned profile')
  const projector = profile.visionProjector
    ? safeFile(modelRoot, profile.visionProjector.relativePath, profile.visionProjector.bytes,
      profile.visionProjector.bytes, inspector, resolver) : null
  // A pinned chat template beside the model, for GGUF files that carry none (2026-11-17: the abliterated 14B).
  const chatTemplate = profile.chatTemplate
    ? safeFile(modelRoot, profile.chatTemplate.relativePath, profile.chatTemplate.bytes,
      profile.chatTemplate.bytes, inspector, resolver) : null
  const server = safeFile(root, SERVER_RELATIVE, SERVER_MIN_BYTES, SERVER_MAX_BYTES, inspector, resolver)
  const adapter = hereticAdapter
    ? safeFile(root, HERETIC_ADAPTER_RELATIVE, 64 * 1024, 16 * 1024 ** 2, inspector, resolver)
    : null
  const runtimeFiles = RUNTIME_FILES.map(([name, minimum]) =>
    safeFile(root, name, minimum, SERVER_MAX_BYTES, inspector, resolver))
  // Open each exact path without following a replacement between inspection
  // and dispatch; compare the opened file identity before allowing launch.
  for (const record of [model, ...(projector ? [projector] : []), ...(chatTemplate ? [chatTemplate] : []), server, ...runtimeFiles, ...(adapter ? [adapter] : [])]) {
    const fd = opener(record.path, 'r')
    try {
      if (!identityStillMatches(record, fstat(fd))) throw new Error('GPT-OSS component changed during preflight')
      if (record === model && profile.verifyHashAtStartup || record === projector || record === chatTemplate) {
        const hash = createHash('sha256'), chunk = Buffer.alloc(4 * 1024 * 1024)
        let count
        while ((count = readSync(fd, chunk, 0, chunk.length, null)) > 0) hash.update(chunk.subarray(0, count))
        const pinnedHash = record === model ? profile.sha256 : record === chatTemplate ? profile.chatTemplate.sha256 : profile.visionProjector.sha256
        if (hash.digest('hex') !== pinnedHash || !identityStillMatches(record, fstat(fd)))
          throw new Error('Selected model does not match its pinned checkpoint')
      }
      if (record === adapter) {
        const digest = createHash('sha256').update(readFileSync(fd)).digest('hex')
        if (digest !== expectedAdapterSha256) throw new Error('Heretic adapter digest does not match the pinned candidate')
      }
    } finally { closer(fd) }
  }
  const executableSha256 = createHash('sha256').update(`${server.dev}:${server.ino}:${server.size}:${server.mtimeMs}:${server.ctimeMs}`).digest('hex')
  return { root, modelPath: model.path, modelSizeBytes: model.size, executablePath: server.path,
    executableSizeBytes: server.size, executableIdentityFingerprint: executableSha256,
    adapterPath: adapter?.path || null, adapterSizeBytes: adapter?.size || null,
    runtimeFiles: runtimeFiles.map(file => file.path), modelProfile: profile,
    projectorPath: projector?.path || null, chatTemplatePath: chatTemplate?.path || null }
}

async function startGptOssService({ root, spawnChild = spawn, fetcher = fetch,
  startupTimeout = STARTUP_TIMEOUT_MS, shutdownTimeout = 10000, signal, inspect,
  checkPort = assertLoopbackPortFree, hereticAdapter = false, contextTokens = 78000,
  localAgentProvider = false, startAgentProvider = startNoriLocalAgentProvider,
  expectedAdapterSha256 = HERETIC_ADAPTER_SHA256, modelProfile = 'gpt-oss-20b' } = {}) {
  const profile = importedModelProfile(modelProfile)
  // Nori's default is 78K. Keep the KV cache in system RAM so the larger
  // window does not consume additional VRAM needed by the desktop and games.
  if (!SUPPORTED_CONTEXT_TOKENS.includes(contextTokens)) throw new RangeError('Unsupported GPT-OSS context profile')
  if (typeof localAgentProvider !== 'boolean') throw new TypeError('Local agent provider selection must be boolean')
  if (localAgentProvider && hereticAdapter) throw new Error('Codex local provider supports only the pinned base GPT-OSS model')
  if (signal?.aborted) throw new Error('GPT-OSS startup cancelled')
  const paths = gptOssLaunchPaths(root, inspect, { hereticAdapter, expectedAdapterSha256, modelProfile })
  await checkPort(PORT)
  if (signal?.aborted) throw new Error('GPT-OSS startup cancelled')
  const args = ['--model', paths.modelPath, '--host', '127.0.0.1', '--port', String(PORT),
    '--jinja', '--ctx-size', String(contextTokens), '--parallel', '1',
    '--n-gpu-layers', String(profile.gpuLayers), '--alias',
    paths.adapterPath ? 'nori-heretic-candidate' : profile.id]
  if(profile.kvCacheMode==='gpu-q8')args.push('--cache-type-k','q8_0','--cache-type-v','q8_0')
  else args.push('--no-kv-offload')
  if(paths.projectorPath)args.push('--mmproj',paths.projectorPath)
  if(paths.chatTemplatePath)args.push('--chat-template-file',paths.chatTemplatePath)
  // Measured on the 16 GiB desktop: retain the 64K RAM cache while moving
  // Qwen's transformer layers to CUDA; a smaller microbatch preserves headroom.
  if (profile.id === 'qwen3.8-27b' || profile.id === 'qwen3.5-9b' || profile.id === 'qwen3-14b') args.push('--flash-attn', 'on', '--ubatch-size', '128')
  // MoE profiles keep a measured number of expert layers on the CPU so the GPU never spills.
  if (Number.isSafeInteger(profile.cpuMoeLayers)) args.push('--n-cpu-moe', String(profile.cpuMoeLayers),
    '--flash-attn', 'on', '--batch-size', '2048', '--ubatch-size', String(profile.ubatchSize ?? 2048))
  // A measured loading mode for a profile (e.g. 'none' keeps an offloaded model's file out of RAM).
  if (profile.loadMode !== undefined) {
    if (!['none', 'mmap'].includes(profile.loadMode)) throw new Error('Unsupported model load mode')
    args.push('--load-mode', profile.loadMode)
  }
  // A measured cap on thinking tokens for models that always reason.
  if (profile.reasoningBudget !== undefined) {
    if (!Number.isSafeInteger(profile.reasoningBudget) || profile.reasoningBudget < 0 || profile.reasoningBudget > 8192) throw new Error('Invalid reasoning budget')
    args.push('--reasoning-budget', String(profile.reasoningBudget))
  }
  if (paths.adapterPath) args.push('--lora', paths.adapterPath)
  const child = spawnChild(paths.executablePath, args, { cwd: paths.root, shell: false,
    windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'], env: { ...process.env, OMP_NUM_THREADS: process.env.OMP_NUM_THREADS || '4' } })
  // Bounded diagnostics, never sent to the model. R84: when a start fails or the engine exits
  // unexpectedly, the last part goes to Nori's local model event log so a stall can be explained.
  let stderrTail = Buffer.alloc(0)
  child.stderr?.on('data', chunk => {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk))
    stderrTail = Buffer.concat([stderrTail, bytes.subarray(-8192)]).subarray(-8192)
  })
  let stopped = false, stopping, spawnFailure = null, agentProvider = null
  const exited = new Promise(resolveExit => {
    child.once('exit', (code, exitSignal) => resolveExit({ code, signal: exitSignal, stderrTail: stderrTail.toString('utf8') }))
    child.once('error', error => {
      spawnFailure = error
      resolveExit({ code: null, error: true, spawnCode: error.code })
    })
  })
  const stop = () => {
    if (stopping) return stopping
    stopped = true
    stopping = (async () => {
      if (agentProvider) {
        const relay = agentProvider
        agentProvider = null
        await relay.stop()
      }
      // A failed spawn has no owned PID to stop. Waiting for an `exit` event
      // after the spawn `error` would time out and mask the useful root cause.
      if (spawnFailure && child.pid == null) return
      if (child.exitCode === null && child.signalCode == null) child.kill('SIGTERM')
      let timer
      const graceful = await Promise.race([exited.then(() => true), new Promise(resolveWait => {
        timer = setTimeout(() => resolveWait(false), shutdownTimeout)
      })])
      clearTimeout(timer)
      if (!graceful && child.exitCode === null && child.signalCode == null) {
        child.kill('SIGKILL')
        let forcedTimer
        const killed = await Promise.race([exited.then(() => true), new Promise(resolveWait => {
          forcedTimer = setTimeout(() => resolveWait(false), 2000)
        })])
        clearTimeout(forcedTimer)
        if (!killed) throw new Error('Owned GPT-OSS server did not stop')
      }
    })()
    return stopping
  }
  const abort = () => { void stop().catch(() => {}) }
  signal?.addEventListener('abort', abort, { once: true })
  const endpoint = `http://127.0.0.1:${PORT}`
  const deadline = Date.now() + startupTimeout
  try {
    while (Date.now() < deadline) {
      if (signal?.aborted || stopped) throw new Error('GPT-OSS startup cancelled')
      const exit = await Promise.race([exited.then(value => ({ exit: value })), new Promise(resolveWait => setTimeout(() => resolveWait(null), 250))])
      if (exit) {
        if (exit.exit.error) {
          throw Object.assign(new Error(`Owned GPT-OSS server could not be started (${exit.exit.spawnCode || 'unknown spawn error'})`),
            { code: 'NORI_GPT_OSS_SPAWN_FAILED' })
        }
        throw new Error(`Owned GPT-OSS server exited before readiness (exit code ${exit.exit.code ?? 'unknown'}${exit.exit.signal ? `, signal ${exit.exit.signal}` : ''})`)
      }
      let healthy = false
      try {
        const response = await fetcher(`${endpoint}/health`, { redirect: 'error', signal: AbortSignal.timeout(1000) })
        healthy = response.ok
      } catch { /* Retry only our fixed loopback readiness endpoint. */ }
      if (healthy) {
        // A relay bind or policy error is a startup failure, not an unhealthy
        // model retry. The catch below stops the owned model process.
        if (localAgentProvider) agentProvider = await startAgentProvider({ modelId: profile.id })
        return {
          endpoint,
          modelId: paths.adapterPath ? 'nori-heretic-candidate' : profile.id,
          source: 'imported-inference-only', contextTokens, child, exited, stop,
          capabilities: Object.freeze({ vision: Boolean(paths.projectorPath) }),
          localAgentProvider: agentProvider ? { endpoint: agentProvider.endpoint, port: agentProvider.port } : null,
          status: {
            service: 'llama.cpp', endpoint,
            modelId: paths.adapterPath ? 'nori-heretic-candidate' : profile.id,
            hereticAdapter: Boolean(paths.adapterPath), hereticQualified: false,
            trainedByNori: false, sonCheckpoint: false,
            localAgentProvider: Boolean(agentProvider),
            modelSizeBytes: paths.modelSizeBytes,
            executableIdentityFingerprint: paths.executableIdentityFingerprint,
          },
        }
      }
      await new Promise(resolveWait => setTimeout(resolveWait, 250))
    }
    throw new Error('GPT-OSS server did not become ready before the deadline')
  } catch (error) {
    try { if (error && typeof error === 'object' && error.stderrTail === undefined) error.stderrTail = stderrTail.toString('utf8') } catch {}
    try { await stop() } catch { throw Object.assign(new Error('Owned GPT-OSS cleanup failed'), { code: 'NORI_GPT_OSS_CLEANUP_FAILED' }) }
    throw error
  } finally { signal?.removeEventListener('abort', abort) }
}

module.exports = { MODEL_RELATIVE, SERVER_RELATIVE, HERETIC_ADAPTER_RELATIVE, HERETIC_ADAPTER_SHA256, STARTUP_TIMEOUT_MS, GPU_LAYERS, SUPPORTED_CONTEXT_TOKENS, resolveGptOssContextTokens,
  RUNTIME_FILES, PORT, gptOssLaunchPaths, startGptOssService }
