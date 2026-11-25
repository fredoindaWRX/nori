// Renderer and chat may request a session; only the native owner dialog grants it.
function createBrowserHost({ dialog, getWindow, owns, stopTimeoutMs = 15000, load = async () => ({
  ...(await import('../bridge/browser-owned-host.mjs')), chromium: require('playwright-core').chromium,
}) }) {
  if (!Number.isInteger(stopTimeoutMs) || stopTimeoutMs < 1 || stopTimeoutMs > 60000) throw Error('Invalid browser shutdown deadline')
  let active = null, starting = false, generation = 0, stopping = null, startSettled = null
  const status = () => {
    // An inactive page may still have an in-flight close. Retain its owner
    // until stop joins that close rather than discarding the cleanup handle.
    return { active: active !== null && active.status().active === true }
  }
  function stop() {
    if (stopping) return stopping
    generation++
    const previous = active
    active = null
    const pendingStart = startSettled
    let timer
    const quiesced = Promise.all([Promise.resolve().then(() => previous?.close()), pendingStart])
    const operation = Promise.race([
      quiesced,
      new Promise((_, reject) => { timer = setTimeout(() => reject(Error('Owned browser did not stop before its shutdown deadline')), stopTimeoutMs) }),
    ]).then(() => status())
      .finally(() => clearTimeout(timer))
    stopping = operation
    // A deadline is not proof the old resources stopped. Permit a replacement
    // only after their actual successful quiescence, including a late finish.
    quiesced.then(() => { if (stopping === operation) stopping = null }, () => {})
    return operation
  }
  async function ask(window, message, detail) {
    const result = await dialog.showMessageBox(window, { type: 'question', title: 'Nori Browser Neuron',
      message, detail, buttons: ['Allow', 'Cancel'], defaultId: 1, cancelId: 1 })
    return result.response === 0
  }
  async function startSession(target, ownerValid) {
      if (!ownerValid() || starting || stopping || status().active) throw Error('Browser cannot start from this request')
      if (active) {
        await stop()
        if (!ownerValid() || starting || stopping) throw Error('Browser cannot start from this request')
      }
      if (!target || Object.keys(target).join() !== 'url' || typeof target.url !== 'string' || target.url.length > 4096) throw Error('Choose a browser URL')
      const url = new URL(target.url)
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw Error('Choose an HTTP website')
      const window = getWindow(), version = generation
      starting = true
      let finishStart
      const settled = new Promise(resolve => { finishStart = resolve })
      startSettled = settled
      try {
        const { startOwnedBrowser, chromium } = await load()
        if (!ownerValid() || getWindow() !== window || generation !== version) throw Error('Browser owner changed')
        if (!await ask(window, 'Start a private Nori browser session?',
          `Website: ${url.origin}\nStart page: ${url.href}\nThis site receives normal browsing requests. No existing browser profile is used. Each click, typing action and navigation asks separately. Session lasts up to ten minutes.`)) return status()
        if (!ownerValid() || getWindow() !== window || generation !== version) throw Error('Browser owner changed')
        const host = await startOwnedBrowser({ chromium, origins: [url.origin], initialUrl: url.href, approved: true,
          confirmAction: async action => {
            if (!ownerValid() || getWindow() !== window || generation !== version) return false
            const decision = await ask(window, `Allow browser ${action.operation}?`,
              `Page: ${action.url}\nControl: ${action.element?.name || '(navigation)'}${action.text === undefined ? '' : `\nText: ${action.text}`}\nApprove only if this matches your task.`)
            return decision && ownerValid() && getWindow() === window && generation === version
          } })
        if (!ownerValid() || getWindow() !== window || generation !== version) { await host.close(); throw Error('Browser owner changed') }
        active = host
        return status()
      } finally {
        starting = false
        finishStart()
        if (startSettled === settled) startSettled = null
      }
  }
  return { status, stop,
    start: (event, target) => startSession(target, () => owns(event)),
    async call(operation, args) {
      if (operation === 'status') return status()
      if (operation === 'stop') return stop()
      if (operation === 'start') {
        const owner = getWindow()
        const ownerValid = () => Boolean(owner && getWindow() === owner && !owner.isDestroyed?.())
        return startSession(args, ownerValid)
      }
      if (!active) throw Error('Start an approved Browser Neuron session first')
      return active.call(operation, args)
    },
  }
}
module.exports = { createBrowserHost }
