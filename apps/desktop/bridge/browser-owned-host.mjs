import { createBrowserPageAdapter } from './browser-page-adapter.mjs'
import { createBrowserActionSession } from './browser-action-session.mjs'

export function approvedBrowserOrigins(values) {
  if (!Array.isArray(values) || !values.length || values.length > 16) throw Error('Explicit approved browser origins required')
  return new Set(values.map(value => {
    if (typeof value !== 'string') throw Error('Invalid browser origin')
    const url = new URL(value)
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password
        || url.pathname !== '/' || url.search || url.hash) throw Error('Exact HTTP browser origin required')
    return url.origin
  }))
}

// Called only by the host after the owner approves these origins and browsing
// network activity. No model-facing start/approve method is exposed here.
export async function startOwnedBrowser({ chromium, origins, initialUrl, confirmAction,
  approved = false, lifetimeMs = 600000, headless = true, channel = 'msedge' }) {
  if (approved !== true || typeof confirmAction !== 'function') throw Error('Browser session approval required')
  if (!Number.isSafeInteger(lifetimeMs) || lifetimeMs < 1000 || lifetimeMs > 600000) throw Error('Invalid browser lifetime')
  const allowed = approvedBrowserOrigins(origins)
  const permits = value => {
    try {
      const url = new URL(value)
      return !url.username && !url.password && allowed.has(url.origin) && ['http:', 'https:'].includes(url.protocol)
    } catch { return false }
  }
  if (!permits(initialUrl)) throw Error('Initial browser URL is not approved')
  let browser, adapter, session, timer, closed = false, closing = null
  const networkOwner = new AbortController()
  function close() {
    if (closing) return closing
    closed = true
    closing = Promise.resolve().then(async () => {
      networkOwner.abort()
      clearTimeout(timer)
      session?.stop()
      try { await adapter?.close() } finally { await browser?.close() }
    })
    return closing
  }
  try {
    browser = await chromium.launch({ channel, headless })
    const context = await browser.newContext({ serviceWorkers: 'block', acceptDownloads: false, permissions: [] })
    await context.route('**/*', async route => {
      if (!permits(route.request().url())) return route.abort('blockedbyclient')
      let response
      try {
        // continue() lets redirected requests bypass this handler. Fetch without
        // following redirects, then validate the destination before forwarding.
        response = await route.fetch({ maxRedirects: 0, timeout: 15000, signal: networkOwner.signal })
        const location = response.headers().location
        if (location && !permits(new URL(location, route.request().url()).href)) return await route.abort('blockedbyclient')
        await route.fulfill({ response })
      } catch { await route.abort('failed').catch(() => {}) }
      finally { await response?.dispose() }
    })
    await context.routeWebSocket('**/*', socket => socket.close())
    const page = await context.newPage()
    context.on('page', popup => { if (popup !== page) void popup.close().catch(() => {}) })
    page.on('dialog', dialog => { void dialog.dismiss().catch(() => {}) })
    page.on('download', download => { void download.cancel().catch(() => {}) })
    page.on('close', () => { void close().catch(() => {}) })
    adapter = createBrowserPageAdapter(page)
    session = createBrowserActionSession({ ...adapter, confirmAction })
    timer = setTimeout(() => { void close().catch(() => {}) }, lifetimeMs)
    timer.unref?.()
    await page.goto(initialUrl, { waitUntil: 'domcontentloaded', timeout: 15000 })
    if (closed || !permits(page.url())) throw Error('Browser session left approved origins')
    let busy = false
    async function call(operation, args = {}) {
      if (closed) throw Error('Browser session closed')
      if (busy) throw Error('Browser operation already running')
      busy = true
      try {
        if (operation !== 'navigate') return await session.call(operation, args)
        if (!args || typeof args !== 'object' || Array.isArray(args)
            || Object.keys(args).join() !== 'url' || typeof args.url !== 'string'
            || args.url.length > 4096 || !permits(args.url)) throw Error('Navigation URL is not approved')
        const decision = await confirmAction(Object.freeze({ sessionId: session.sessionId,
          operation: 'navigate', url: new URL(args.url).href }))
        if (closed) throw Error('Browser session closed')
        if (decision !== true) throw Error('Browser navigation not approved')
        // Invalidate all prior snapshots even if goto fails or returns the same URL.
        session.stop()
        session = createBrowserActionSession({ ...adapter, confirmAction })
        try {
          await page.goto(args.url, { waitUntil: 'domcontentloaded', timeout: 15000 })
          if (closed || !permits(page.url())) throw Error('Browser navigation left approved origins')
          return await session.call('inspect')
        } catch (error) { await close(); throw error }
      } finally { busy = false }
    }
    return Object.freeze({ call, close, status: () => ({ active: !closed }) })
  } catch (error) { await close(); throw error }
}
