// Bound renderer inspection independently of the outer process deadline.
async function inspectProbeRenderer(window, script, { timeoutMs = 5000 } = {}) {
  if (!window || window.isDestroyed()) throw Error('Probe renderer window closed before inspection')
  let timer
  try {
    return await Promise.race([
      window.webContents.executeJavaScript(script),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(Error('Probe renderer inspection timed out')), timeoutMs)
      }),
    ])
  } finally { clearTimeout(timer) }
}
module.exports = { inspectProbeRenderer }
