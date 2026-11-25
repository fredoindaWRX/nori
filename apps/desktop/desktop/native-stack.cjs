// One owner for Core + our inference runtime. Unexpected death fails closed;
// normal stop drains Core before stopping its GPU service. No fallback backend.
const { startNativeService } = require('./native-service.cjs')
const { startNativeCore } = require('./native-core.cjs')
const { workerEnvironment } = require('./worker-environment.cjs')

async function startNativeStack({ root, environment = process.env, signal, dataRoot, stateRoot = root, requirePreparedState = false, configName,
  startRuntime = startNativeService, startCore = startNativeCore } = {}) {
  const startup = new AbortController()
  let ready = false
  const abort = () => {
    startup.abort()
    if (ready) void stop().catch(() => {})
  }
  if (signal?.aborted) startup.abort()
  signal?.addEventListener('abort', abort, { once: true })
  let runtime, core, stopping, stopRequested = false, exitBeforeStop = false
  const stop = () => {
    // The original child object records exit synchronously. If quit occurs
    // before promise observers run, don't erase a death already recorded on
    // that owned handle. Numeric PID lookup is not used to adopt any process.
    if (!stopRequested && ready) exitBeforeStop = [runtime, core].some(component =>
      component?.child && (Number.isInteger(component.child.exitCode) ||
        typeof component.child.signalCode === 'string' && component.child.signalCode.length > 0))
    stopRequested = true
    if (stopping) return stopping
    stopping = (async () => {
      try { if (core) await core.stop() }
      finally {
        try { if (runtime) await runtime.stop() }
        finally { signal?.removeEventListener('abort', abort) }
      }
    })()
    return stopping
  }
  try {
    runtime = await startRuntime({ root, environment, signal: startup.signal, ...(configName === undefined ? {} : { configName }) })
    // A runtime death during Core startup cancels that startup, not a restart.
    runtime.exited.then(() => startup.abort())
    const worker = workerEnvironment(environment, runtime)
    core = await startCore({ root, runtime, environment: { ...environment, ...worker }, signal: startup.signal, dataRoot, stateRoot, requirePreparedState })
    if (startup.signal.aborted) throw new Error('Owned native stack stopped during startup')
    ready = true
    const exited = Promise.race([
      runtime.exited.then(result => ({ component: 'runtime', ...result })),
      core.exited.then(result => ({ component: 'core', ...result })),
    ]).then(async result => {
      // Capture before awaiting sibling cleanup. A later user quit must not
      // relabel an already observed unexpected death as a requested stop.
      const unexpected = !stopRequested || exitBeforeStop
      try {
        if (unexpected) await stop()
        return { ...result, unexpected }
      } catch { return { ...result, unexpected, cleanupFailed: true } }
    })
    return { stop, exited, environment: { ...runtime.environment, ...core.environment, ...worker },
      status: { ...runtime.status, ...core.status }, runtime, core }
  } catch (error) {
    startup.abort()
    try { await stop() } catch {
      throw Object.assign(new Error('Owned native startup cleanup failed'), { code: 'NORI_OWNED_CLEANUP_FAILED' })
    }
    throw error
  }
}

module.exports = { startNativeStack }
