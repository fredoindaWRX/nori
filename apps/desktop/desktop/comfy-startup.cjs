'use strict'

/** Nori uses ComfyUI's loopback API, not its optional browser asset manager. */
function comfyLaunchArgs({ inputDirectory, outputDirectory, tempDirectory, userDirectory, port, extraModelPaths }) {
  return ['-B', '-s', 'main.py', '--windows-standalone-build', '--listen', '127.0.0.1', '--port', String(port),
    '--disable-auto-launch', '--disable-all-custom-nodes', '--disable-assets', '--lowvram',
    '--input-directory', inputDirectory, '--output-directory', outputDirectory,
    '--temp-directory', tempDirectory, '--user-directory', userDirectory,
    ...(extraModelPaths?['--extra-model-paths-config',extraModelPaths]:[])]
}

/** Wait for the owned local ComfyUI child without hiding an early exit. */
async function waitForComfyStartup(child, isReady, {
  timeoutMs = 120_000,
  pollMs = 250,
  now = Date.now,
  sleep = ms => new Promise(resolve => setTimeout(resolve, ms)),
} = {}) {
  if (!child || typeof child.once !== 'function' || typeof child.kill !== 'function') {
    throw new TypeError('An owned ComfyUI child process is required')
  }
  if (typeof isReady !== 'function') throw new TypeError('A ComfyUI readiness check is required')
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 300_000) {
    throw new RangeError('timeoutMs must be between 1 and 300000')
  }
  if (!Number.isSafeInteger(pollMs) || pollMs < 1 || pollMs > 5000) {
    throw new RangeError('pollMs must be between 1 and 5000')
  }

  let spawnError = null
  child.once('error', error => { spawnError = error })
  const deadline = now() + timeoutMs
  while (true) {
    if (spawnError) return { status: 'failed', reason: 'spawn_error', child, error: spawnError }
    if (child.exitCode !== null || child.signalCode !== null) {
      return { status: 'failed', reason: 'child_exited', child, exitCode: child.exitCode, signalCode: child.signalCode }
    }
    try {
      if (await isReady()) return { status: 'ready', child }
    } catch { /* A not-yet-listening loopback service is still starting. */ }
    const remaining = deadline - now()
    if (remaining <= 0) return { status: 'failed', reason: 'readiness_timeout', child }
    await sleep(Math.min(pollMs, remaining))
  }
}

module.exports = { comfyLaunchArgs, waitForComfyStartup }
