const { setTimeout: delay } = require('node:timers/promises')

// Own one loopback listener. Transient Tailscale/startup failures must not make
// phone access unavailable until the next desktop restart.
function createPrivatePhoneChannel({ getContext, create, onReady = () => {}, onUnavailable = () => {}, onDiagnostic = () => {}, retryMs = 3000, maxRetryMs = 30000 }) {
  if (typeof getContext !== 'function' || typeof create !== 'function') throw new TypeError('Private phone factories required')
  if (!Number.isInteger(retryMs) || retryMs < 1 || !Number.isInteger(maxRetryMs) || maxRetryMs < retryMs) throw new TypeError('Invalid phone retry budget')
  const controller = new AbortController()
  let active = null, phase = 'starting', stopPromise = null
  const run = (async () => {
    let failures = 0
    while (!controller.signal.aborted) {
      let candidate = null
      try {
        phase = 'identity'
        const context = await getContext()
        if (controller.signal.aborted) break
        phase = 'adapters'
        candidate = await create(context)
        if (!candidate || typeof candidate.stop !== 'function' || !candidate.ready || typeof candidate.server?.once !== 'function') throw new TypeError('Owned phone listener required')
        phase = 'listen'
        let onAbort
        try {
          await Promise.race([
            candidate.ready,
            new Promise((_, reject) => {
              onAbort = () => reject(Object.assign(new Error('Phone startup stopped'), { name: 'AbortError' }))
              controller.signal.addEventListener('abort', onAbort, { once: true })
              if (controller.signal.aborted) onAbort()
            }),
          ])
        } finally {
          if (onAbort) controller.signal.removeEventListener('abort', onAbort)
        }
        if (controller.signal.aborted) break
        active = candidate
        phase = 'ready'
        failures = 0
        onReady(context.origin)
        await new Promise(resolve => {
          const done = () => { candidate.server.removeListener('close', done); candidate.server.removeListener('error', done); controller.signal.removeEventListener('abort', done); resolve() }
          candidate.server.once('close', done)
          candidate.server.once('error', done)
          controller.signal.addEventListener('abort', done, { once: true })
          if (controller.signal.aborted) done()
        })
      } catch (error) {
        if (!controller.signal.aborted) onDiagnostic({ phase, code: /^[A-Z0-9_]{1,48}$/.test(error?.code || '') ? error.code : 'PHONE_CHANNEL_UNAVAILABLE' })
      } finally {
        active = null
        onUnavailable()
        if (candidate) {
          try { await candidate.stop() }
          catch {
            phase = 'stop-failed'
            onDiagnostic({ phase: 'stop', code: 'PHONE_STOP_FAILED' })
            return
          }
        }
      }
      if (controller.signal.aborted) break
      phase = 'retrying'
      failures = Math.min(failures + 1, 5)
      try { await delay(Math.min(maxRetryMs, retryMs * 2 ** (failures - 1)), undefined, { signal: controller.signal }) }
      catch { break }
    }
    phase = 'stopped'
  })()
  return {
    get status() { return { phase, ready: Boolean(active) } },
    stop() { if (!stopPromise) { controller.abort(); stopPromise = run }; return stopPromise },
  }
}

module.exports = { createPrivatePhoneChannel }
