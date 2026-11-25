/** Shared discovery and permission contract for local applications, browsers, and network adapters. */

export const HOST_CAPABILITY_CONTRACT = 'nori.host-capability.v1'

export const HOST_PERMISSION = Object.freeze({
  DISCOVER: 'discover',
  READ: 'read',
  INTERACT: 'interact',
  SIDE_EFFECT: 'side_effect',
  PRIVILEGED: 'privileged',
})

const ORDER = Object.freeze({ discover: 0, read: 1, interact: 2, side_effect: 3, privileged: 4 })
const ID = /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/
const OPERATIONS = new Set(['discover', 'status', 'read', 'inspect', 'navigate', 'launch', 'interact', 'type', 'click', 'invoke', 'write', 'send', 'delete', 'install', 'control'])

function permission(value) {
  if (!Object.hasOwn(ORDER, value)) throw new TypeError(`Unsupported host permission: ${value}`)
  return value
}

function operation(value) {
  if (typeof value !== 'string' || !OPERATIONS.has(value)) throw new TypeError(`Unsupported host operation: ${value}`)
  return value
}

function descriptor(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new TypeError('Host capability descriptor must be an object')
  if (typeof input.id !== 'string' || !ID.test(input.id)) throw new TypeError('Host capability id is invalid')
  if (typeof input.kind !== 'string' || !/^[a-z][a-z0-9_-]{1,40}$/.test(input.kind)) throw new TypeError('Host capability kind is invalid')
  if (typeof input.provider !== 'string' || input.provider.length < 1 || input.provider.length > 120) throw new TypeError('Host capability provider is invalid')
  if (!Array.isArray(input.operations) || input.operations.length < 1 || input.operations.length > 32) throw new TypeError('Host capability operations are invalid')
  const operations = input.operations.map(item => {
    const value = typeof item === 'string' ? { name: item, permission: item === 'read' || item === 'inspect' || item === 'status' ? 'read' : 'interact' } : item
    if (!value || typeof value !== 'object') throw new TypeError('Host operation must be a string or object')
    return Object.freeze({ name: operation(value.name), permission: permission(value.permission), approval: value.approval === 'session' || value.approval === 'owner' ? value.approval : 'none' })
  })
  const unique = new Set(operations.map(item => item.name))
  if (unique.size !== operations.length) throw new TypeError('Host capability operations must be unique')
  return Object.freeze({
    contract: HOST_CAPABILITY_CONTRACT,
    id: input.id,
    kind: input.kind,
    provider: input.provider,
    label: typeof input.label === 'string' ? input.label.slice(0, 160) : input.id,
    target: typeof input.target === 'string' ? input.target.slice(0, 240) : null,
    origin: input.origin === 'user' || input.origin === 'system' ? input.origin : 'adapter',
    status: input.status === 'disabled' ? 'disabled' : 'available',
    operations: Object.freeze(operations),
    metadata: Object.freeze(input.metadata && typeof input.metadata === 'object' ? { ...input.metadata } : {}),
  })
}

export function standardHostCapabilities({ browser = true, defaultBrowser = true, windowControl = true, publicNetwork = true } = {}) {
  const result = []
  if (browser) result.push({ id: 'browser.chrome.session', kind: 'browser', provider: 'chrome-extension', label: 'User Chrome session', target: 'user-session', operations: [
    { name: 'status', permission: 'read' }, { name: 'read', permission: 'read' }, { name: 'inspect', permission: 'read' },
    { name: 'navigate', permission: 'interact', approval: 'session' }, { name: 'click', permission: 'side_effect', approval: 'owner' },
    { name: 'type', permission: 'side_effect', approval: 'owner' }, { name: 'control', permission: 'side_effect', approval: 'owner' },
  ] })
  if (defaultBrowser) result.push({ id: 'browser.default.launch', kind: 'browser', provider: 'system-default-browser', label: 'System default browser', target: 'default', operations: [
    { name: 'launch', permission: 'interact', approval: 'session' },
  ] })
  if (windowControl) result.push({ id: 'window.selected.approved', kind: 'window', provider: 'windows-computer-host', label: 'Owner-approved application window', target: 'selected-window', operations: [
    { name: 'status', permission: 'read' }, { name: 'inspect', permission: 'read' },
    { name: 'interact', permission: 'side_effect', approval: 'owner' }, { name: 'type', permission: 'side_effect', approval: 'owner' },
    { name: 'invoke', permission: 'side_effect', approval: 'owner' },
  ] })
  if (publicNetwork) result.push({ id: 'network.public.read', kind: 'network', provider: 'guarded-http-proxy', label: 'Public web read access', target: 'https://*', operations: [
    { name: 'read', permission: 'read' }, { name: 'discover', permission: 'discover' },
  ] })
  return result
}

function token(value, fallback) {
  const text = String(value ?? '').trim().toLowerCase().replace(/[^a-z0-9.-]+/g, '-').replace(/^-+|-+$/g, '')
  return text || fallback
}

/**
 * Convert already-observed host facts into descriptors. This function does not
 * enumerate processes, read browser cookies, or grant access; OS/browser
 * adapters supply observations and the registry applies the same permission
 * contract to every provider.
 */
export function discoverHostCapabilities({ browsers = [], applications = [], windows = [], defaultBrowser = false } = {}) {
  const descriptors = standardHostCapabilities({ browser: false, defaultBrowser, windowControl: false, publicNetwork: true })
  for (const browser of Array.isArray(browsers) ? browsers.slice(0, 16) : []) {
    const id = `browser.${token(browser.id || browser.name, 'session')}`
    descriptors.push({ id, kind: 'browser', provider: String(browser.provider || 'browser-adapter').slice(0, 120),
      label: String(browser.label || browser.name || id).slice(0, 160), target: String(browser.target || 'observed-session').slice(0, 240),
      origin: 'adapter', metadata: { browser: token(browser.name, 'unknown'), attached: browser.attached === true }, operations: [
        { name: 'status', permission: 'read' }, { name: 'read', permission: 'read' }, { name: 'inspect', permission: 'read' },
        { name: 'navigate', permission: 'interact', approval: 'session' }, { name: 'click', permission: 'side_effect', approval: 'owner' },
        { name: 'type', permission: 'side_effect', approval: 'owner' },
      ] })
  }
  for (const application of Array.isArray(applications) ? applications.slice(0, 32) : []) {
    const id = `application.${token(application.id || application.name, 'observed')}`
    descriptors.push({ id, kind: 'application', provider: String(application.provider || 'os-shell').slice(0, 120),
      label: String(application.label || application.name || id).slice(0, 160), target: String(application.target || application.executable || 'observed-application').slice(0, 240),
      metadata: { pid: Number.isSafeInteger(application.pid) ? application.pid : null }, operations: [
        { name: 'status', permission: 'read' }, { name: 'launch', permission: 'interact', approval: 'session' },
      ] })
  }
  for (const window of Array.isArray(windows) ? windows.slice(0, 64) : []) {
    const suffix = token(window.windowHandle || window.processId || window.title, 'observed')
    descriptors.push({ id: `window.${suffix}`, kind: 'window', provider: 'windows-computer-host', label: String(window.title || 'Observed window').slice(0, 160),
      target: 'observed-window', metadata: { processId: Number.isSafeInteger(window.processId) ? window.processId : null, windowHandle: Number.isSafeInteger(window.windowHandle) ? window.windowHandle : null }, operations: [
        { name: 'status', permission: 'read' }, { name: 'inspect', permission: 'read' },
        { name: 'interact', permission: 'side_effect', approval: 'owner' }, { name: 'type', permission: 'side_effect', approval: 'owner' },
      ] })
  }
  return createHostCapabilityRegistry({ descriptors })
}

export function createHostCapabilityRegistry({ descriptors = standardHostCapabilities(), audit = () => {} } = {}) {
  const entries = new Map()
  const events = []
  const record = event => {
    const receipt = Object.freeze({ contract: HOST_CAPABILITY_CONTRACT, timestamp: new Date().toISOString(), ...event })
    events.push(receipt)
    audit(receipt)
    return receipt
  }
  const register = input => {
    const value = descriptor(input)
    if (entries.has(value.id)) throw new Error(`Host capability already registered: ${value.id}`)
    entries.set(value.id, value)
    record({ type: 'registered', capabilityId: value.id, kind: value.kind, provider: value.provider })
    return value
  }
  for (const item of descriptors) register(item)
  const discover = ({ kind, status = 'available' } = {}) => [...entries.values()]
    .filter(item => (!kind || item.kind === kind) && (!status || item.status === status))
    .map(item => ({ id: item.id, kind: item.kind, provider: item.provider, label: item.label, target: item.target, status: item.status, operations: item.operations.map(op => ({ ...op })), metadata: { ...item.metadata } }))
  const authorize = ({ capabilityId, operation: requestedOperation, requiredPermission, sessionApproved = false, ownerApproved = false, reason = '' } = {}) => {
    const item = entries.get(capabilityId)
    const requested = operation(requestedOperation)
    if (!item) return record({ type: 'denied', capabilityId, operation: requested, decision: 'denied', reason: 'unknown_capability' })
    if (item.status !== 'available') return record({ type: 'denied', capabilityId, operation: requested, decision: 'denied', reason: 'capability_unavailable' })
    const op = item.operations.find(candidate => candidate.name === requested)
    if (!op) return record({ type: 'denied', capabilityId, operation: requested, decision: 'denied', reason: 'operation_not_declared' })
    if (requiredPermission && ORDER[op.permission] < ORDER[permission(requiredPermission)]) return record({ type: 'denied', capabilityId, operation: requested, decision: 'denied', reason: 'permission_tier_insufficient' })
    if (op.approval === 'session' && !sessionApproved) return record({ type: 'needs_approval', capabilityId, operation: requested, decision: 'needs_approval', approval: 'session', reason: reason || 'session_approval_required' })
    if ((op.approval === 'owner' || ORDER[op.permission] >= ORDER.side_effect) && !ownerApproved) return record({ type: 'needs_approval', capabilityId, operation: requested, decision: 'needs_approval', approval: 'owner', reason: reason || 'owner_approval_required' })
    return record({ type: 'allowed', capabilityId, operation: requested, decision: 'allowed', permission: op.permission, approval: op.approval })
  }
  return Object.freeze({
    contract: HOST_CAPABILITY_CONTRACT,
    register,
    discover,
    authorize,
    events: () => events.map(item => ({ ...item })),
  })
}
