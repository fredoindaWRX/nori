import { randomUUID } from 'node:crypto'

// Visible document text is observation, never an actionable target or instruction.
function readContent() {
  const walker = document.createTreeWalker(document.body || document.documentElement, NodeFilter.SHOW_TEXT)
  const parts = []; let size = 0, visited = 0, truncated = false
  while (walker.nextNode()) {
    if (++visited > 5000) { truncated = true; break }
    const node = walker.currentNode, parent = node.parentElement
    if (!parent || parent.closest('script,style,noscript,template,input,textarea,select,button,output,[contenteditable]:not([contenteditable="false"]),[role="textbox"],[role="status"],[role="alert"]')) continue
    let visible = true
    for (let ancestor = parent; ancestor; ancestor = ancestor.parentElement) {
      const style = getComputedStyle(ancestor)
      if (ancestor.hidden || ancestor.getAttribute('aria-hidden') === 'true' || style.display === 'none'
          || style.visibility === 'hidden' || style.visibility === 'collapse' || style.opacity === '0') { visible = false; break }
    }
    if (!visible || !parent.getClientRects().length) continue
    const text = (node.textContent || '').replace(/\s+/g, ' ').trim()
    if (!text) continue
    const remaining = 6000 - size - (parts.length ? 1 : 0)
    if (remaining <= 0) { truncated = true; break }
    parts.push(text.slice(0, remaining)); size += parts.at(-1).length + (parts.length > 1 ? 1 : 0)
    if (text.length > remaining) { truncated = true; break }
  }
  return { text: parts.join('\n'), truncated }
}

// DOM metadata only. Never return input values, passwords or page-provided IDs.
function describe(element) {
  const tag = element.tagName.toLowerCase(), type = (element.getAttribute('type') || '').toLowerCase()
  const sensitive = type === 'password' || /password|cc-|one-time-code/.test(element.autocomplete || '')
  const style = element.ownerDocument.defaultView.getComputedStyle(element)
  const visible = element.isConnected && element.getClientRects().length > 0
    && style.visibility !== 'hidden' && style.visibility !== 'collapse'
  const readOnlyResult = tag === 'output' || ['status', 'alert'].includes(element.getAttribute('role'))
  const name = element.getAttribute('aria-label') || element.labels?.[0]?.innerText || element.innerText || element.getAttribute('placeholder') || ''
  return { name: name.slice(0, 1000), role: element.getAttribute('role') || tag,
    ...(readOnlyResult ? { text: (element.innerText || '').slice(0, 1000) } : {}),
    sensitive: sensitive || !visible, canClick: visible && !element.disabled && !readOnlyResult,
    canFill: visible && !element.disabled && !element.readOnly && !sensitive
      && (tag === 'textarea' || (tag === 'input' && ['text', 'search', 'email', 'url', 'tel', ''].includes(type))) }
}

export function createBrowserPageAdapter(page) {
  let documentId = randomUUID(), handles = new Map(), stopped = false
  const lastFills = new Map()
  const invalidate = () => { documentId = randomUUID(); lastFills.clear() }
  const closed = () => { stopped = true; invalidate() }
  page.on('framenavigated', invalidate)
  page.on('close', closed)
  function active(signal) {
    signal?.throwIfAborted()
    if (stopped || page.isClosed()) throw Error('Owned browser tab closed')
  }
  async function clear() {
    const old = handles
    handles = new Map()
    await Promise.all([...old.values()].map(async item => { await item.handle.dispose().catch(() => {}) }))
  }
  async function inspect({ signal } = {}) {
    active(signal)
    // Preserve identity for surviving DOM nodes across the post-approval check.
    const previous = handles, next = new Map(), elements = [], revision = documentId
    const found = await page.$$('button,a[href],input,textarea,select,[role="button"],output,[role="status"],[role="alert"]')
    try {
      for (const handle of found.slice(0, 200)) {
        active(signal)
        const metadata = await handle.evaluate(describe)
        if (metadata.sensitive || (!metadata.canClick && !metadata.canFill
            && !['output', 'status', 'alert'].includes(metadata.role))) { await handle.dispose(); continue }
        let id = randomUUID()
        for (const [oldId, old] of previous) {
          if (await handle.evaluate((node, other) => node === other, old.handle).catch(() => false)) { id = oldId; break }
        }
        next.set(id, { handle, metadata })
        const matchesLastFill = lastFills.has(id)
          ? await handle.evaluate((node, expected) => node.value === expected, lastFills.get(id)) : null
        elements.push({ id, ...metadata, matchesLastFill })
      }
      const content = await page.evaluate(readContent)
      active(signal)
      if (revision !== documentId) throw Error('Browser navigated during inspection')
      await clear()
      handles = next
      for (const id of lastFills.keys()) if (!next.has(id)) lastFills.delete(id)
      return { documentId, url: page.url(), elements, content }
    } catch (error) {
      await Promise.all(found.map(handle => handle.dispose().catch(() => {})))
      await clear()
      throw error
    } finally {
      await Promise.all(found.slice(200).map(handle => handle.dispose().catch(() => {})))
    }
  }
  async function execute(action, { signal } = {}) {
    active(signal)
    const item = handles.get(action.element?.id)
    if (!item || action.documentId !== documentId || action.url !== page.url()) throw Error('Stale browser target')
    const current = await item.handle.evaluate(describe)
    const expected = { ...action.element }; delete expected.id
    delete expected.matchesLastFill
    const comparison = { ...current }; delete comparison.sensitive
    if (current.sensitive || JSON.stringify(comparison) !== JSON.stringify(expected)) throw Error('Browser control changed')
    active(signal)
    // Playwright actions do not accept AbortSignal. Close only this owned tab to
    // interrupt an in-flight action; cancellation does not undo a submitted action.
    const cancel = () => { stopped = true; void page.close({ runBeforeUnload: false }).catch(() => {}) }
    signal?.addEventListener('abort', cancel, { once: true })
    try {
      active(signal)
      // Bind the original DOM node; replacement nodes cannot inherit authority.
      if (action.operation === 'click' && current.canClick) await item.handle.click({ timeout: 5000 })
      else if (action.operation === 'fill' && current.canFill) {
        await item.handle.fill(action.text, { timeout: 5000 })
        lastFills.set(action.element.id, action.text)
      }
      else throw Error('Unsupported browser action')
      active(signal)
      return { completed: true }
    } finally { signal?.removeEventListener('abort', cancel) }
  }
  return { inspect, execute, async close() {
    stopped = true
    lastFills.clear()
    page.off('framenavigated', invalidate)
    page.off('close', closed)
    await clear()
  } }
}
