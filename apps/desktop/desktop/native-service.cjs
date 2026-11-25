// Explicitly owned local runtime lifecycle. Keys stay in the main/bridge processes,
// never renderer messages, command arguments, logs or a file.
const { spawn } = require('node:child_process')
const { randomBytes, createHash } = require('node:crypto')
const { existsSync, readFileSync, realpathSync, statSync } = require('node:fs')
const { isAbsolute, join, relative, resolve } = require('node:path')
const { startGptOssService, resolveGptOssContextTokens } = require('./gpt-oss-service.cjs')
const NATIVE_STARTUP_TIMEOUT_MS = 90000

function nativeRuntimeMode(environment = process.env) {
  const mode = environment.NORI_INFERENCE_RUNTIME || 'norllama'
  if (!['norllama', 'gpt-oss'].includes(mode)) throw new Error('Nori requires an explicitly supported local runtime;no implicit fallback allowed')
  return mode
}

function packagedRuntimeMode({ packaged = false, args = [], environment = process.env } = {}) {
  if (typeof packaged !== 'boolean' || !Array.isArray(args)) throw new TypeError('Invalid packaged runtime selection')
  const gptOss = args.includes('--nori-gpt-oss') || args.includes('--nori-gpt-oss-heretic') || args.includes('--nori-qwen38')
  const small = args.includes('--nori-norllama') || args.includes('--nori-native-qwen')
  if (gptOss && small) throw new Error('Select only one Nori local model profile')
  if (gptOss) return 'gpt-oss'
  if (small) return 'norllama'
  return packaged ? 'gpt-oss' : nativeRuntimeMode(environment)
}

function containedFile(root, name) {
  if (typeof name !== 'string' || !name || isAbsolute(name)) throw new Error('Native component path must be relative to Nori')
  const target = realpathSync(resolve(root, name))
  const delta = relative(root, target)
  const info = statSync(target)
  if (delta.startsWith('..') || isAbsolute(delta) || !info.isFile()) throw new Error('Native component escapes Nori root')
  if (info.size === 0) throw new Error('Native component is empty')
  return target
}

function nativeLaunchPaths(root, environment = process.env, configName = 'runtime/norllama/config.json') {
  root = realpathSync(root)
  // An alternate profile cannot bypass the project's unavailable serving model.
  if (configName !== 'runtime/norllama/config.json') {
    const primaryPath = containedFile(root, 'runtime/norllama/config.json')
    if (statSync(primaryPath).size > 65536) throw new Error('Native runtime configuration is too large')
    const primary = JSON.parse(readFileSync(primaryPath, 'utf8').replace(/^\uFEFF/, ''))
    if (primary.status === 'UNAVAILABLE') throw Object.assign(
      new Error('NORI-20B SoN serving is unavailable; its checkpoint has not yet been created and qualified.'),
      { code: 'NORI_MODEL_UNAVAILABLE' },
    )
  }
  const entry = containedFile(root, 'runtime/norllama/norllama.py')
  const configPath = containedFile(root, configName)
  if (statSync(configPath).size > 65536) throw new Error('Native runtime configuration is too large')
  const configBytes = readFileSync(configPath)
  const configSha256 = createHash('sha256').update(configBytes).digest('hex')
  const config = JSON.parse(configBytes.toString('utf8').replace(/^\uFEFF/, ''))
  if (config.status === 'UNAVAILABLE') throw Object.assign(
    new Error('NORI-20B SoN serving is unavailable; its checkpoint has not yet been created and qualified.'),
    { code: 'NORI_MODEL_UNAVAILABLE' },
  )
  const resourceMode = environment.NORI_RUNTIME_RESOURCE_COORDINATION
  if (resourceMode !== undefined && !['0','1'].includes(resourceMode)) throw new Error('Invalid resource coordination mode')
  const resourceCoordination = resourceMode === '1'
  const hasResources = Object.hasOwn(config, 'resource_coordination')
  if (resourceCoordination !== hasResources) throw new Error('Resource coordination flag and configuration must agree')
  if (hasResources) {
    const value = config.resource_coordination
    const required = ['schema','database','limits','worker']
    if (!value || typeof value !== 'object' || Array.isArray(value) || value.schema !== 1 ||
        required.some(name => !Object.hasOwn(value,name)) ||
        Object.keys(value).some(name => ![...required,'wait_seconds'].includes(name)) ||
        typeof value.database !== 'string' || !/^state[\\/]private[\\/][A-Za-z0-9_.-]+\.sqlite3$/.test(value.database) ||
        (Object.hasOwn(value,'wait_seconds') && (typeof value.wait_seconds !== 'number' ||
          !Number.isFinite(value.wait_seconds) || value.wait_seconds < 0 || value.wait_seconds > 60))) {
      throw new Error('Invalid desktop resource coordination configuration')
    }
  }
  if (!/^[A-Za-z0-9._:-]{1,128}$/.test(config.model_id || '')) throw new Error('Invalid native model identifier')
  const cachePrecision = config.cache_precision === undefined ? 'f32' : config.cache_precision
  if (!['f32', 'f16'].includes(cachePrecision)) throw new Error('Invalid native cache precision;no fallback allowed')
  const promptLimit = config.prompt_limit === undefined ? 2048 : config.prompt_limit
  const computeBackend = config.compute_backend === undefined ? 'cuda' : config.compute_backend
  const qwen35 = config.architecture === 'imported-qwen35'
  const requestTimeout = config.request_timeout_seconds ?? 120
  if (!Number.isInteger(requestTimeout) || ![120,300].includes(requestTimeout))
    throw new Error('Native request timeout must be explicitly 120 or 300 seconds')
  const cpuWeightCacheBudget = config.cpu_weight_cache_budget ?? 0
  const cpuTiled = config.cpu_tiled ?? false
  if (typeof cpuTiled !== 'boolean' ||
      (cpuTiled && (computeBackend !== 'cpu' || cpuWeightCacheBudget !== 0))) {
    throw new Error('Invalid opt-in tiled CPU mode;requires CPU backend without decoded-weight caching')
  }
  if (!Number.isInteger(cpuWeightCacheBudget) || ![0,2*1024**3,8*1024**3].includes(cpuWeightCacheBudget) ||
      (cpuWeightCacheBudget && computeBackend !== 'cpu')) throw new Error('Invalid CPU weight cache budget')
  if (!['cuda', 'cpu'].includes(computeBackend) ||
      (computeBackend === 'cpu' && (cachePrecision !== 'f32' || promptLimit !== 2048))) {
    throw new Error('Invalid native compute backend capability;no fallback allowed')
  }
  if (qwen35 && (promptLimit !== 65536 || cachePrecision !== 'f32' || computeBackend !== 'cuda'))
    throw new Error('Invalid Qwen native configuration;requires explicit 65536 bound, F32 state and CUDA matrices')
  if (!Number.isInteger(promptLimit) || !(qwen35 ? [65536] : [2048,4096]).includes(promptLimit) ||
      (promptLimit === 4096 && cachePrecision !== 'f16')) throw new Error('Invalid native context capability;no fallback allowed')
  containedFile(root, config.engine_binary)
  containedFile(root, config.model_path)
  const candidates = environment.NORI_RUNTIME_PYTHON
    ? [environment.NORI_RUNTIME_PYTHON]
    : [join(root, 'python', 'Python311', 'python.exe')]
  const python = candidates.find(path => isAbsolute(path) && existsSync(path) && statSync(path).isFile() && statSync(path).size > 0)
  if (!python) throw new Error('Nori needs its bundled or configured Python3.11+ runtime;no installation was attempted')
  return { root, entry, python, modelId: config.model_id, cachePrecision, promptLimit, computeBackend, cpuWeightCacheBudget, cpuTiled, configPath, configSha256, resourceCoordination, qwen35, requestTimeout }
}

async function startNativeService({ root, environment = process.env, spawnChild = spawn, fetcher = fetch,
  // CUDA cold-start/model initialization can exceed 30 seconds on Windows.
  // Keep the parent window longer than the runtime worker's 75-second load
  // deadline so it can report a real worker failure instead of racing it.
  startupTimeout = NATIVE_STARTUP_TIMEOUT_MS,
  shutdownTimeout = 10000, signal, scanHardware, configName } = {}) {
  if (signal?.aborted) throw new Error('Native runtime startup cancelled')
  if (environment.NORI_MINI_AUTO_MODEL !== undefined && !['0','1'].includes(environment.NORI_MINI_AUTO_MODEL))
    throw new Error('Invalid portable automatic model mode')
  const resourceConfig = environment.NORI_RUNTIME_RESOURCE_CONFIG
  if (resourceConfig !== undefined) {
    if (typeof resourceConfig !== 'string' || resourceConfig.length > 256 ||
        !/^state[\\/]private[\\/][A-Za-z0-9_-][A-Za-z0-9_.-]*\.json$/.test(resourceConfig))
      throw new Error('Resource profile must be a private Nori configuration')
    if (environment.NORI_RUNTIME_RESOURCE_COORDINATION !== '1')
      throw new Error('Resource profile requires explicit coordination authorization')
    if (configName !== undefined || environment.NORI_MINI_AUTO_MODEL === '1')
      throw new Error('Resource profile conflicts with explicit or automatic model selection')
    configName = resourceConfig
  }
  const automatic = environment.NORI_MINI_AUTO_MODEL === '1'
    ? await require('./portable-model-selection.cjs').selectPortableModel(root,{scan:scanHardware,signal}) : null
  if (signal?.aborted) throw new Error('Native runtime startup cancelled')
  if (automatic && configName !== undefined) throw new Error('Explicit runtime config cannot override automatic model selection')
  const paths = nativeLaunchPaths(root, environment, automatic?.configName ?? configName)
  if(automatic && (paths.configPath!==automatic.configPath || paths.configSha256!==automatic.configSha256))
    throw Error('Portable configuration changed between selection and native startup')
  if(automatic && realpathSync(paths.python)!==realpathSync(join(paths.root,'python','Python311','python.exe')))
    throw Error('Portable startup requires its verified bundled Python interpreter')
  const key = randomBytes(48).toString('base64url')
  const child = spawnChild(paths.python, ['-B', paths.entry,
    ...((automatic || configName !== undefined) ? ['--config', paths.configPath] : []),
    ...(paths.resourceCoordination ? ['--resource-coordination'] : []), '--port', '0', '--supervised'], {
    cwd: paths.root, shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'],
    env: { ...environment, NORI_RUNTIME_API_KEY: key },
  })
  let endpoint, stopped = false, stopping, startupError
  const exited = new Promise(resolveExit => {
    child.once('exit', (code, exitSignal) => resolveExit({ code, exitSignal }))
    child.once('error', error => { startupError = error; resolveExit({ code: null, error: true }) })
  })
  child.stdin.on('error', () => {}) // Closing owner pipe is expected on startup failure.
  const auth = { Authorization: `Bearer ${key}` }
  const stop = () => {
    if (stopping) return stopping
    stopped = true
    stopping = (async () => {
      // EOF is also the shutdown signal if the launcher disappears. HTTP is
      // private and graceful;the worker's Job Object covers forced runtime exit.
      if (endpoint && child.exitCode === null && !startupError) {
        try {
          await fetcher(`${endpoint}/v1/shutdown`, { method: 'POST', redirect: 'error',
            headers: { ...auth, 'content-type': 'application/json' }, body: '{}', signal: AbortSignal.timeout(1500) })
        } catch { /* owner pipe/owned child cleanup below remains available */ }
      }
      child.stdin.end()
      let timer
      const graceful = await Promise.race([exited.then(() => true), new Promise(resolveWait => {
        timer = setTimeout(() => resolveWait(false), shutdownTimeout)
      })])
      clearTimeout(timer)
      if (!graceful) {
        child.kill() // Exact owned runtime child;its own worker Job closes on death.
        let forcedTimer
        const killed = await Promise.race([exited.then(() => true), new Promise(resolveWait => {
          forcedTimer = setTimeout(() => resolveWait(false), 2000)
        })])
        clearTimeout(forcedTimer)
        if (!killed) throw new Error('Owned NorLlama process did not stop')
      }
    })()
    return stopping
  }
  const abort = () => { void stop().catch(() => {}) }
  signal?.addEventListener('abort', abort, { once: true })
  let timer
  try {
    const ready = await new Promise((resolveReady, reject) => {
      let buffer = ''
      const finish = (error, record) => {
        clearTimeout(timer)
        child.removeListener('error', onError)
        child.removeListener('exit', onExit)
        child.stdout.removeListener('data', onData)
        buffer = ''
        child.stdout.resume() // Drain later output without retaining an unbounded log.
        if (error) reject(error)
        else resolveReady(record)
      }
      const onError = () => finish(new Error('Own NorLlama process could not start'))
      const onExit = () => finish(new Error('Own NorLlama exited before readiness'))
      const onData = bytes => {
        buffer += bytes.toString('utf8')
        if (buffer.length > 4096) { finish(new Error('Invalid native startup record')); return }
        if (!buffer.includes('\n')) return
        try {
          const record = JSON.parse(buffer.slice(0, buffer.indexOf('\n')))
          if (record.runtime !== 'NorLlama' || record.backend !== 'norama-independent' ||
              !Number.isInteger(record.port) || record.port < 1 || record.port > 65535 ||
              !Number.isInteger(record.worker_pid) || record.worker_pid < 1 ||
              record.cache_precision !== paths.cachePrecision ||
              (record.request_timeout_seconds ?? 120) !== paths.requestTimeout ||
              (paths.qwen35 && (record.architecture !== 'imported-qwen35' || record.max_output_tokens !== 2048)) ||
              (record.resource_coordination ?? false) !== paths.resourceCoordination ||
              (record.compute_backend ?? 'cuda') !== paths.computeBackend ||
              (record.cpu_weight_cache_budget ?? 0) !== paths.cpuWeightCacheBudget ||
              (record.cpu_tiled ?? false) !== paths.cpuTiled ||
              (paths.cpuTiled && (!Number.isInteger(record.cpu_tiled_weight_tile_bytes) ||
                record.cpu_tiled_weight_tile_bytes <= 0 || record.cpu_tiled_weight_tile_bytes > 64*1024**2)) ||
              (record.max_prompt_tokens ?? 2048) !== paths.promptLimit ||
              (paths.promptLimit === 4096 && record.max_output_tokens !== 2048)) throw new Error('Invalid native startup record')
          finish(null, record)
        } catch { finish(new Error('Invalid native startup record')) }
      }
      timer = setTimeout(() => finish(new Error('Own NorLlama startup deadline exceeded')), startupTimeout)
      child.once('error', onError)
      child.once('exit', onExit)
      child.stdout.on('data', onData)
    })
    clearTimeout(timer)
    if (stopped) throw new Error('Native runtime startup cancelled')
    endpoint = `http://127.0.0.1:${ready.port}`
    const response = await fetcher(`${endpoint}/health`, { headers: auth, redirect: 'error', signal: AbortSignal.timeout(3000) })
    const health = await response.json()
    if (!response.ok || health.ready !== true || health.backend !== 'norama-independent' ||
        health.worker_pid !== ready.worker_pid || health.model_id !== paths.modelId ||
        health.cache_precision !== paths.cachePrecision ||
        (health.request_timeout_seconds ?? 120) !== paths.requestTimeout ||
        (paths.qwen35 && (health.architecture !== 'imported-qwen35' || health.qwen_matrix_cache_budget !== 13*1024**3)) ||
        (health.compute_backend ?? 'cuda') !== paths.computeBackend ||
        (health.cpu_weight_cache_budget ?? 0) !== paths.cpuWeightCacheBudget ||
        (health.cpu_tiled ?? false) !== paths.cpuTiled ||
        (paths.cpuTiled && (!Number.isInteger(health.cpu_tiled_weight_tile_bytes) ||
          health.cpu_tiled_weight_tile_bytes <= 0 || health.cpu_tiled_weight_tile_bytes > 64*1024**2)) ||
        (paths.cpuWeightCacheBudget && (!Number.isInteger(health.cpu_weight_cache_required_bytes) ||
          health.cpu_weight_cache_required_bytes <= 0 || health.cpu_weight_cache_required_bytes > paths.cpuWeightCacheBudget)) ||
        (health.max_prompt_tokens ?? 2048) !== paths.promptLimit ||
        (paths.promptLimit === 4096 && health.max_output_tokens !== 2048) || stopped || child.exitCode !== null) {
      throw new Error('Own NorLlama readiness contract failed;no fallback used')
    }
    return {
      child, exited, stop,
      environment: { NORI_INFERENCE_RUNTIME: 'norllama', NORI_RUNTIME_URL: endpoint,
        NORI_RUNTIME_MODEL_STATE: 'ready',
        NORI_RUNTIME_API_KEY: key, NORI_RUNTIME_MODEL_ID: paths.modelId, NORI_LOCAL_CHAT: '1',
        NORI_RUNTIME_CONFIG_PATH: paths.configPath,
        NORI_RUNTIME_REQUEST_TIMEOUT_SECONDS: String(paths.requestTimeout),
        NORI_NATIVE_CORE_READY: '0' },
      status: { runtime: 'NorLlama', backend: 'norama-independent', modelId: paths.modelId,
        ...(paths.qwen35 ? { architecture: 'imported-qwen35' } : {}),
        ...(automatic ? {automaticModelSelection:automatic.selection} : {}),
        workerPid: ready.worker_pid, runtimePid: child.pid, cachePrecision: health.cache_precision,
        computeBackend: paths.computeBackend,
        resourceCoordination: paths.resourceCoordination,
        cpuWeightCacheBudget: paths.cpuWeightCacheBudget,
        cpuWeightCacheRequiredBytes: health.cpu_weight_cache_required_bytes ?? 0,
        cpuTiled: paths.cpuTiled,
        maxPromptTokens: paths.promptLimit, maxOutputTokens: 2048 },
    }
  } catch (error) {
    clearTimeout(timer)
    try { await stop() } catch {
      throw Object.assign(new Error('Owned native startup cleanup failed'), { code: 'NORI_OWNED_CLEANUP_FAILED' })
    }
    throw error
  } finally {
    signal?.removeEventListener('abort', abort)
  }
}

// Exposed as an explicit imported-model service only. It is not selected as a
// NorLlama/SoN fallback and does not alter the normal native startup path.
module.exports = { nativeRuntimeMode, packagedRuntimeMode, nativeLaunchPaths, startNativeService, startGptOssService, resolveGptOssContextTokens,
  NATIVE_STARTUP_TIMEOUT_MS }
