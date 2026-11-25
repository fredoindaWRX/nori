// Exact owned direct children only. A kill request is not proof of exit.
// Unmanaged processes and Chromium's complete profile lifetime need separate
// quiescence evidence before live migration.
async function drainDesktopWriters(children, { timeoutMs = 5000 } = {}) {
  if (!Array.isArray(children) || !Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30000)
    throw Error('Invalid desktop writer drain contract')
  await Promise.all([...new Set(children.filter(Boolean))].map(child => {
    if (child.exitCode !== null && child.exitCode !== undefined ||
        child.signalCode !== null && child.signalCode !== undefined ||
        child.startupError && !child.pid) return
    return new Promise((resolve, reject) => {
      let timer
      const finish = error => {
        clearTimeout(timer)
        child.removeListener('exit', onExit)
        child.removeListener('error', onError)
        if (error) reject(error); else resolve()
      }
      const onExit = () => finish()
      const onError = () => { if (!child.pid) finish(); else finish(Error('Owned desktop writer cleanup failed')) }
      child.once('exit', onExit)
      child.once('error', onError)
      timer = setTimeout(() => finish(Error('Owned desktop writer did not exit before deadline')), timeoutMs)
      try { if (!child.killed) child.kill() } catch { finish(Error('Owned desktop writer termination failed')) }
    })
  }))
  return { ownedWritersDrained: true, unmanagedWriterQuiescenceVerified: false }
}
// Repeated quit requests join the same drain, including a failed drain. Never
// retry implicitly and turn a prior cleanup failure into successful ownership.
function onceDesktopShutdown(cleanup) {
  if (typeof cleanup !== 'function') throw Error('Desktop cleanup callback required')
  let pending
  return () => {
    if (!pending) pending = Promise.resolve().then(cleanup)
    return pending
  }
}
module.exports = { drainDesktopWriters, onceDesktopShutdown }
