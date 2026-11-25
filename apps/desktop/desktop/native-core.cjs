// Own only the child we launched. No fixed-port service adoption, token files,
// sensor activation, legacy fallback or promise that native tools are qualified.
const { spawn } = require('node:child_process')
const { randomBytes } = require('node:crypto')
const { existsSync, realpathSync, statSync, mkdirSync } = require('node:fs')
const { isAbsolute, relative, resolve, join } = require('node:path')
const { nativeLaunchPaths } = require('./native-service.cjs')
const { acquireStateOwner, recoverDeadOwnerRecord } = require('./state-owner.cjs')
const ROLES = Object.freeze(['sentinel', 'architect', 'oracle', 'trinity', 'neo',
  'morpheus', 'tank', 'keymaker', 'apoc', 'smith', 'machine', 'merovingian'])

function redactStartupTail(text, environment, truncated) {
  const secrets = Object.entries(environment)
    .filter(([name, value]) => /(?:TOKEN|KEY|SECRET|PASSWORD)/i.test(name)
      && typeof value === 'string' && value.length >= 8)
    .map(([, value]) => value).sort((a, b) => b.length - a.length)
  for (const secret of secrets) {
    // Capture can start inside a credential, or the child can exit mid-write.
    // Remove boundary fragments before applying the final display-size limit.
    // Ignore tiny overlaps: ordinary words commonly share one or two chars
    // with a credential prefix, and redacting them corrupts useful diagnostics.
    const minimumBoundaryOverlap = Math.min(8, secret.length - 1)
    if (truncated) {
      for (let size = Math.min(text.length, secret.length - 1); size > 0; size--) {
        if (size >= minimumBoundaryOverlap && text.startsWith(secret.slice(-size))) {
          text = '[REDACTED]' + text.slice(size)
          break
        }
      }
    }
    text = text.split(secret).join('[REDACTED]')
    for (let size = Math.min(text.length, secret.length - 1); size > 0; size--) {
      if (size >= minimumBoundaryOverlap && text.endsWith(secret.slice(0, size))) {
        text = text.slice(0, -size) + '[REDACTED]'
        break
      }
    }
  }
  return text.slice(-8192)
}

function coreLaunchPaths(root, environment, configName) {
  if (environment.NORI_INFERENCE_RUNTIME === 'gpt-oss') {
    root = realpathSync(root)
    const inside = (relativePath) => {
      const target = realpathSync(resolve(root, relativePath))
      const delta = relative(root, target)
      if (delta.startsWith('..') || isAbsolute(delta) || !statSync(target).isFile() || !statSync(target).size) {
        throw new Error('Imported Core component must be a nonempty file inside Nori')
      }
      return target
    }
    const entry = inside('nori/main.py')
    const pythonCandidate = environment.NORI_RUNTIME_PYTHON || join(root, 'python', 'Python311', 'python.exe')
    if (!isAbsolute(pythonCandidate)) throw new Error('Imported Core requires an absolute local Python path')
    const python = realpathSync(pythonCandidate)
    const pythonDelta = relative(root, python)
    if (pythonDelta.startsWith('..') || isAbsolute(pythonDelta) || !statSync(python).isFile() || !statSync(python).size) {
      throw new Error('Imported Core Python runtime must be inside Nori')
    }
    const modelId = environment.NORI_GPT_OSS_SERVER_MODEL
    if (typeof modelId !== 'string' || !/^[A-Za-z0-9._:-]{1,128}$/.test(modelId)
        || environment.NORI_RUNTIME_MODEL_ID !== modelId) {
      throw new Error('Imported Core requires an explicit matching GPT-OSS model identity')
    }
    const endpoint = new URL(environment.NORI_GPT_OSS_URL || '')
    if (endpoint.protocol !== 'http:' || endpoint.hostname !== '127.0.0.1' || !endpoint.port
        || endpoint.username || endpoint.password || endpoint.pathname !== '/' || endpoint.search || endpoint.hash) {
      throw new Error('Imported Core requires the owned GPT-OSS IPv4 loopback endpoint')
    }
    return { root, entry, python, modelId, backend: 'llama.cpp-openai-compatible-imported' }
  }
  const paths = nativeLaunchPaths(root, environment, configName)
  const entry = realpathSync(join(paths.root, 'nori', 'main.py'))
  const delta = relative(paths.root, entry)
  if (delta.startsWith('..') || isAbsolute(delta) || !statSync(entry).isFile()) throw new Error('Core source escapes Nori root')
  if (statSync(entry).size === 0) throw new Error('Core entrypoint is empty')
  return { ...paths, entry, backend: 'norama-independent' }
}

function coreReadyRecord(record, modelId, backend = 'norama-independent') {
  if (!record || record.runtime !== 'NoriCore' || record.backend !== backend ||
    record.model_id !== modelId || record.sensors_enabled !== 0 || record.task_execution_qualified !== false ||
    !record.ports || typeof record.ports !== 'object' || Array.isArray(record.ports) ||
    Object.keys(record.ports).length !== ROLES.length || ROLES.some(role =>
      !Number.isInteger(record.ports[role]) || record.ports[role] < 1 || record.ports[role] > 65535) ||
    new Set(Object.values(record.ports)).size !== ROLES.length) throw new Error('Invalid owned Core readiness record')
  return record
}

function coreStatePath(root, candidate, stateRoot = root) {
  const base = resolve(stateRoot)
  const physicalBase = realpathSync(base)
  const normalize = value => process.platform === 'win32' ? value.toLowerCase() : value
  if (!isAbsolute(stateRoot) || normalize(physicalBase) !== normalize(base) || !statSync(physicalBase).isDirectory()) {
    throw new Error('Core state root must be a canonical Nori folder')
  }
  const state = resolve(candidate || join(base, 'state', 'core'))
  const delta = relative(base, state)
  if (!delta || delta.startsWith('..') || isAbsolute(delta)) throw new Error('Core state must remain inside Nori')
  // Lexical containment alone misses existing junctions pointing outside Nori.
  // Resolve the nearest existing ancestor before allowing Python to create state.
  let ancestor = state
  while (!existsSync(ancestor)) ancestor = resolve(ancestor, '..')
  const physical = realpathSync(ancestor)
  const physicalDelta = relative(base, physical)
  if (physicalDelta.startsWith('..') || isAbsolute(physicalDelta) || !statSync(physical).isDirectory()) {
    throw new Error('Core state ancestor escapes Nori root')
  }
  if (normalize(physical) !== normalize(ancestor)) throw new Error('Linked Core state ancestor refused')
  return state
}

async function startNativeCore({ root, runtime, environment = process.env, spawnChild = spawn,
  fetcher = fetch, startupTimeout = 30000, shutdownTimeout = 30000, signal, dataRoot, stateRoot = root,
  requirePreparedState = false, onStartupDiagnostic } = {}) {
  if (onStartupDiagnostic !== undefined && typeof onStartupDiagnostic !== 'function') throw new TypeError('Invalid Core diagnostic callback')
  if (signal?.aborted) throw new Error('Native Core startup cancelled')
  const ownedConfig = runtime?.environment?.NORI_INFERENCE_RUNTIME === 'norllama'
    ? runtime.environment.NORI_RUNTIME_CONFIG_PATH : undefined
  if (ownedConfig !== undefined && (typeof ownedConfig !== 'string' || !isAbsolute(ownedConfig)))
    throw new Error('Core requires the owned runtime absolute configuration path')
  const paths = coreLaunchPaths(root, environment, ownedConfig === undefined ? undefined :
    relative(realpathSync(root), ownedConfig))
  if (paths.backend === 'llama.cpp-openai-compatible-imported') {
    if (runtime?.environment?.NORI_INFERENCE_RUNTIME !== 'gpt-oss'
        || runtime?.status?.modelId !== paths.modelId
        || runtime?.environment?.NORI_GPT_OSS_URL !== environment.NORI_GPT_OSS_URL
        || runtime?.environment?.NORI_GPT_OSS_SERVER_MODEL !== paths.modelId) {
      throw new Error('Core requires the matching owned imported GPT-OSS runtime; no fallback allowed')
    }
  } else if (runtime?.environment?.NORI_INFERENCE_RUNTIME !== 'norllama' || runtime?.status?.modelId !== paths.modelId ||
    !/^http:\/\/127\.0\.0\.1:\d{1,5}$/.test(runtime.environment.NORI_RUNTIME_URL || '') ||
    !/^[A-Za-z0-9_-]{32,128}$/.test(runtime.environment.NORI_RUNTIME_API_KEY || '')) {
    throw new Error('Core requires the owned native runtime;no fallback allowed')
  }
  const runtimePromptLimit = paths.backend === 'norama-independent' ? runtime?.status?.maxPromptTokens : null
  if (paths.backend === 'norama-independent' && !(paths.qwen35 ? [65536] : [2048,4096]).includes(runtimePromptLimit)) {
    throw new Error('Core requires the owned runtime prompt capability;no fallback allowed')
  }
  // Test callers can supply isolated state; production defaults to main Nori.
  const state = coreStatePath(paths.root, dataRoot, stateRoot)
  const key = randomBytes(48).toString('base64url')
  const suiteConfig = join(paths.root, 'nori', 'config.native-suite.json')
  if (!existsSync(suiteConfig)) throw new Error('Native suite Core configuration is missing')
  const physicalConfig = realpathSync(suiteConfig)
  const configDelta = relative(paths.root, physicalConfig)
  if (configDelta.startsWith('..') || isAbsolute(configDelta) || !statSync(physicalConfig).isFile()) throw new Error('Native Core configuration escapes Nori')
  if (statSync(physicalConfig).size === 0) throw new Error('Native Core configuration is empty')
  if(requirePreparedState){
    if(!dataRoot||!existsSync(state)||!statSync(state).isDirectory())
      throw Error('Prepared native Core state is missing; no data created')
  }else mkdirSync(state, { recursive: true })
  coreStatePath(paths.root, state, stateRoot)
  recoverDeadOwnerRecord(state)
  const owner = acquireStateOwner(state)
  const workerApprovalKey = randomBytes(32).toString('hex')
  const systemApprovalKey = randomBytes(32).toString('hex')
  const coreEnvironment = { ...environment, ...runtime.environment, NORI_DATA_ROOT: state, NORI_API_TOKEN: key,
    NORI_WORKER_APPROVAL_KEY: workerApprovalKey,
    NORI_SYSTEM_APPROVAL_KEY: systemApprovalKey,
    NORI_BIND: '127.0.0.1' }
  if (runtimePromptLimit !== null) coreEnvironment.NORI_RUNTIME_MAX_PROMPT_TOKENS = String(runtimePromptLimit)
  if (paths.qwen35) {
    coreEnvironment.NORI_AIDER_API_BASE = `${runtime.environment.NORI_RUNTIME_URL}/openai/v1`
    coreEnvironment.NORI_AIDER_MODEL = `openai/${paths.modelId}`
    coreEnvironment.NORI_AIDER_API_KEY = runtime.environment.NORI_RUNTIME_API_KEY
  }
  // Native memory does not use Letta. Do not forward legacy credentials or
  // endpoints inherited from a development shell (Windows names ignore case).
  for (const name of Object.keys(coreEnvironment)) {
    if (name.toUpperCase().startsWith('NORI_LETTA_')) delete coreEnvironment[name]
  }
  let child
  try { child = spawnChild(paths.python, ['-B', paths.entry, '--config', physicalConfig, '--supervised', '--managed-native'], {
    cwd: paths.root, shell: false, windowsHide: true, stdio: ['pipe', 'pipe', onStartupDiagnostic ? 'pipe' : 'ignore'],
    env: coreEnvironment,
  }) } catch (error) { owner.release(); throw error }
  let diagnosticTail = ''
  let diagnosticTruncated = false
  const collectDiagnostic = chunk => {
    const next = diagnosticTail + chunk.toString('utf8')
    diagnosticTruncated ||= next.length > 16384
    diagnosticTail = next.slice(-16384)
  }
  child.stderr?.on('data', collectDiagnostic)
  let stopping, stopped = false, spawnError = false
  let ownershipReleaseFailed = false
  const releaseOwner = () => { try { owner.release() } catch { ownershipReleaseFailed = true } }
  const exited = new Promise(resolveExit => {
    child.once('exit', (code, exitSignal) => { releaseOwner(); resolveExit({ code, exitSignal }) })
    child.once('error', () => { spawnError = true; if (!child.pid) releaseOwner(); resolveExit({ code: null, error: true }) })
  })
  child.stdin.on('error', () => {})
  const stop = () => {
    if (stopping) return stopping
    stopped = true
    stopping = (async () => {
      child.stdin.end()
      let timer
      const done = await Promise.race([exited.then(() => true), new Promise(resolveWait => {
        timer = setTimeout(() => resolveWait(false), shutdownTimeout)
      })])
      clearTimeout(timer)
      if (!done) {
        child.kill()
        let forcedTimer
        const killed = await Promise.race([exited.then(() => true), new Promise(resolveWait => {
          forcedTimer = setTimeout(() => resolveWait(false), 2000)
        })])
        clearTimeout(forcedTimer)
        if (!killed) throw new Error('Owned native Core did not stop')
      }
      if (ownershipReleaseFailed) throw new Error('Core state ownership release failed; record preserved')
    })()
    return stopping
  }
  const abort = () => { void stop().catch(() => {}) }
  signal?.addEventListener('abort', abort, { once: true })
  let timer
  try {
    const ready = await new Promise((resolveReady, reject) => {
      let buffer = '', bytesSeen = 0, finished = false
      const finish = (error, record) => {
        if (finished) return
        finished = true
        clearTimeout(timer)
        child.removeListener('error', onError)
        child.removeListener('exit', onExit)
        child.stdout.removeListener('data', onData)
        child.stderr?.removeListener('data', collectDiagnostic)
        child.stderr?.resume()
        diagnosticTail = ''
        buffer = ''
        child.stdout.resume()
        if (error) reject(error)
        else resolveReady(record)
      }
      const onError = () => finish(new Error('Owned native Core could not start'))
      const onExit = (code, exitSignal) => {
        if (onStartupDiagnostic) {
          const stderr = redactStartupTail(diagnosticTail, coreEnvironment, diagnosticTruncated)
          try { onStartupDiagnostic({ code, signal: exitSignal ?? null, stderr }) } catch {}
        }
        diagnosticTail = ''
        finish(new Error(`Owned native Core exited before readiness (exit ${code ?? 'unknown'})`))
      }
      const onData = bytes => {
        bytesSeen += bytes.length
        buffer += bytes.toString('utf8')
        if (bytesSeen > 65536 || buffer.length > 8192) { finish(new Error('Invalid Core startup output')); return }
        while (buffer.includes('\n')) {
          const line = buffer.slice(0, buffer.indexOf('\n')).trim()
          buffer = buffer.slice(buffer.indexOf('\n') + 1)
          if (!line.startsWith('{')) continue
          try {
            const record = coreReadyRecord(JSON.parse(line), paths.modelId, paths.backend)
            finish(null, record)
          } catch { finish(new Error('Invalid owned Core readiness record')) }
          return
        }
      }
      timer = setTimeout(() => finish(new Error('Owned native Core startup deadline exceeded')), startupTimeout)
      child.once('error', onError)
      child.once('exit', onExit)
      child.stdout.on('data', onData)
    })
    for (const role of ROLES) {
      if (stopped || spawnError || child.exitCode !== null) throw new Error('Owned Core startup cancelled or exited')
      const response = await fetcher(`http://127.0.0.1:${ready.ports[role]}/health`, {
        headers: { Authorization: `Bearer ${key}` }, redirect: 'error',
        signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(3000)]) : AbortSignal.timeout(3000),
      })
      const health = await response.json()
      if (!response.ok || health.knight !== role || health.model_ready !== true ||
        health.sensory?.configured_count !== 0) throw new Error('Owned Core readiness contract failed')
    }
    if (stopped || spawnError || child.exitCode !== null) throw new Error('Owned Core exited during readiness')
    return { child, exited, stop, workerApprovalKey, systemApprovalKey, environment: { NORI_API_TOKEN: key,
      NORI_COUNCIL_URL: `http://127.0.0.1:${ready.ports.architect}`,
      NORI_NATIVE_CORE_READY: '1', NORI_NATIVE_TOOLS_QUALIFIED: '0' },
      status: { corePid: child.pid, ports: { ...ready.ports }, modelId: paths.modelId,
        backend: paths.backend,
        sensorsEnabled: 0, taskExecutionQualified: false } }
  } catch (error) {
    clearTimeout(timer)
    try { await stop() } catch {
      throw Object.assign(new Error('Owned native startup cleanup failed'), { code: 'NORI_OWNED_CLEANUP_FAILED' })
    }
    throw error
  } finally { signal?.removeEventListener('abort', abort) }
}

module.exports = { ROLES, coreLaunchPaths, coreReadyRecord, coreStatePath, startNativeCore }
