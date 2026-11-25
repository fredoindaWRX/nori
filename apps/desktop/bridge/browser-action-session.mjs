import { randomUUID } from 'node:crypto'

// Host-owned session: neither a page nor a model can provide confirmAction.
// The adapter must bind inspect/execute to one isolated, Nori-owned browser tab.
export function createBrowserActionSession({ inspect, execute, confirmAction, now = Date.now }) {
  if ([inspect, execute, confirmAction, now].some(value => typeof value !== 'function')) {
    throw Error('Owned browser adapter and host confirmation required')
  }
  const controller = new AbortController(), sessionId = randomUUID()
  let snapshot = null, busy = false
  function active() { controller.signal.throwIfAborted() }
  async function observe() {
    const result = await inspect({ signal: controller.signal })
    active()
    if (!result || typeof result.documentId !== 'string' || !result.documentId
        || result.documentId.length > 200 || typeof result.url !== 'string'
        || result.url.length > 4096 || !Array.isArray(result.elements) || result.elements.length > 200) {
      throw Error('Invalid browser observation')
    }
    const url = new URL(result.url)
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw Error('Unsupported browser page')
    const content = result.content
    if (content !== undefined && (!content || typeof content.text !== 'string' || content.text.length > 6000
        || typeof content.truncated !== 'boolean')) throw Error('Invalid browser page content')
    const ids = new Set()
    const elements = result.elements.map(item => {
      if (!item || typeof item.id !== 'string' || !item.id || item.id.length > 200 || ids.has(item.id)
          || typeof item.name !== 'string' || item.name.length > 1000 || typeof item.role !== 'string'
          || item.role.length > 100 || item.sensitive !== false) throw Error('Unsafe browser control')
      if (item.text !== undefined && (typeof item.text !== 'string' || item.text.length > 1000
          || !['output', 'status', 'alert'].includes(item.role)
          || item.canClick || item.canFill)) throw Error('Unsafe browser result text')
      ids.add(item.id)
      return Object.freeze({ id: item.id, name: item.name, role: item.role,
        ...(item.text !== undefined ? { text: item.text } : {}),
        canClick: item.canClick === true, canFill: item.canFill === true,
        matchesLastFill: typeof item.matchesLastFill === 'boolean' ? item.matchesLastFill : null })
    })
    return Object.freeze({ documentId: result.documentId, url: result.url, elements: Object.freeze(elements),
      ...(content ? { content: Object.freeze({ text: content.text, truncated: content.truncated }) } : {}) })
  }
  async function act(operation, args) {
    const allowed = operation === 'click' ? ['snapshotId', 'elementId'] : ['snapshotId', 'elementId', 'text']
    if (Object.keys(args).sort().join() !== allowed.sort().join()) throw Error('Invalid browser action fields')
    if (!snapshot || args.snapshotId !== snapshot.id || now() - snapshot.at > 30000) throw Error('Inspect browser again')
    const previous = snapshot
    snapshot = null // consume even if denied or the adapter fails; never replay an uncertain action
    const element = previous.page.elements.find(item => item.id === args.elementId)
    if (!element || !(operation === 'click' ? element.canClick : element.canFill)) throw Error('Unsupported observed control')
    if (operation === 'fill' && (typeof args.text !== 'string' || args.text.length > 4000 || args.text.includes('\0'))) throw Error('Invalid browser text')
    const proposal = Object.freeze({ sessionId, operation, url: previous.page.url, element,
      ...(operation === 'fill' ? { text: args.text } : {}) })
    const approved = await confirmAction(proposal)
    active()
    if (approved !== true) throw Error('Browser action not approved')
    if (now() - previous.at > 30000) throw Error('Browser observation expired during approval')
    const fresh = await observe()
    if (fresh.documentId !== previous.page.documentId || fresh.url !== previous.page.url
        || !fresh.elements.some(item => JSON.stringify(item) === JSON.stringify(element))) throw Error('Browser target changed')
    const result = await execute({ ...proposal, documentId: fresh.documentId }, { signal: controller.signal })
    active()
    if (result?.completed !== true) throw Error('Browser action outcome is unverified; inspect before retrying')
    return { completed: true, verificationRequired: true, sessionId }
  }
  return Object.freeze({ sessionId,
    stop() { snapshot = null; controller.abort() },
    async call(operation, args = {}) {
      active()
      if (busy) throw Error('Browser operation already running')
      if (!args || typeof args !== 'object' || Array.isArray(args)) throw Error('Invalid browser arguments')
      if (!['inspect', 'click', 'fill'].includes(operation)) throw Error('Unsupported browser operation')
      busy = true
      try {
        if (operation !== 'inspect') return await act(operation, args)
        if (Object.keys(args).length) throw Error('Unexpected inspection arguments')
        snapshot = null
        const page = await observe()
        snapshot = { id: randomUUID(), at: now(), page }
        return { sessionId, snapshotId: snapshot.id, ...page }
      } finally { busy = false }
    },
  })
}
