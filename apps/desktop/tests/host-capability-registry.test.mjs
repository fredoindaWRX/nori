import test from 'node:test'
import assert from 'node:assert/strict'
import { createHostCapabilityRegistry, discoverHostCapabilities, standardHostCapabilities, HOST_CAPABILITY_CONTRACT } from '../bridge/host-capability-registry.mjs'

test('standard host capabilities discover browser, default browser, approved window, and public network adapters', () => {
  const registry = createHostCapabilityRegistry()
  const all = registry.discover()
  assert.equal(registry.contract, HOST_CAPABILITY_CONTRACT)
  assert.deepEqual(all.map(item => item.id), [
    'browser.chrome.session',
    'browser.default.launch',
    'window.selected.approved',
    'network.public.read',
  ])
  assert.equal(registry.discover({ kind: 'browser' }).length, 2)
  assert.equal(registry.discover({ kind: 'window' })[0].target, 'selected-window')
})

test('observed host facts become descriptive capabilities without implicit control approval', () => {
  const registry = discoverHostCapabilities({
    browsers: [{ id: 'edge-session', name: 'Microsoft Edge', provider: 'edge-extension', attached: true }],
    applications: [{ id: 'notepad', name: 'Notepad', executable: 'notepad.exe', pid: 42 }],
    windows: [{ title: 'Notes', processId: 42, windowHandle: 1001 }],
    defaultBrowser: true,
  })
  assert.equal(registry.discover({ kind: 'browser' }).some(item => item.id === 'browser.edge-session'), true)
  assert.equal(registry.discover({ kind: 'application' })[0].metadata.pid, 42)
  const window = registry.discover({ kind: 'window' })[0]
  assert.equal(window.metadata.windowHandle, 1001)
  assert.equal(registry.authorize({ capabilityId: 'browser.edge-session', operation: 'click', sessionApproved: true }).decision, 'needs_approval')
  assert.equal(registry.authorize({ capabilityId: window.id, operation: 'inspect' }).decision, 'allowed')
})

test('read operations are allowed without side-effect approval', () => {
  const registry = createHostCapabilityRegistry()
  const receipt = registry.authorize({ capabilityId: 'browser.chrome.session', operation: 'read' })
  assert.equal(receipt.contract, HOST_CAPABILITY_CONTRACT)
  assert.equal(receipt.type, 'allowed')
  assert.equal(receipt.capabilityId, 'browser.chrome.session')
  assert.equal(receipt.operation, 'read')
  assert.equal(receipt.decision, 'allowed')
  assert.equal(receipt.permission, 'read')
  assert.equal(receipt.approval, 'none')
  assert.match(receipt.timestamp, /^\d{4}-\d{2}-\d{2}T/)
})

test('browser navigation requires a session approval and page actions require owner approval', () => {
  const registry = createHostCapabilityRegistry()
  assert.equal(registry.authorize({ capabilityId: 'browser.chrome.session', operation: 'navigate' }).decision, 'needs_approval')
  assert.equal(registry.authorize({ capabilityId: 'browser.chrome.session', operation: 'navigate', sessionApproved: true }).decision, 'allowed')
  assert.equal(registry.authorize({ capabilityId: 'browser.chrome.session', operation: 'click', sessionApproved: true }).decision, 'needs_approval')
  assert.equal(registry.authorize({ capabilityId: 'browser.chrome.session', operation: 'click', sessionApproved: true, ownerApproved: true }).decision, 'allowed')
})

test('window typing and invocation cannot bypass owner approval', () => {
  const registry = createHostCapabilityRegistry()
  assert.equal(registry.authorize({ capabilityId: 'window.selected.approved', operation: 'inspect' }).decision, 'allowed')
  const denied = registry.authorize({ capabilityId: 'window.selected.approved', operation: 'type', sessionApproved: true })
  assert.equal(denied.decision, 'needs_approval')
  assert.equal(denied.approval, 'owner')
  assert.equal(registry.authorize({ capabilityId: 'window.selected.approved', operation: 'type', sessionApproved: true, ownerApproved: true }).decision, 'allowed')
})

test('unknown, undeclared, and unavailable capabilities are denied and audited', () => {
  const audit = []
  const registry = createHostCapabilityRegistry({ audit: event => audit.push(event) })
  assert.equal(registry.authorize({ capabilityId: 'window.missing', operation: 'inspect' }).reason, 'unknown_capability')
  assert.equal(registry.authorize({ capabilityId: 'browser.chrome.session', operation: 'delete' }).reason, 'operation_not_declared')
  const disabled = createHostCapabilityRegistry({ descriptors: [{ ...standardHostCapabilities()[0], status: 'disabled' }] })
  assert.equal(disabled.authorize({ capabilityId: 'browser.chrome.session', operation: 'read' }).reason, 'capability_unavailable')
  assert.equal(audit.filter(event => event.type === 'denied').length, 2)
})

test('discovery metadata is descriptive only and never grants permission', () => {
  const registry = createHostCapabilityRegistry({ descriptors: [{
    id: 'application.editor', kind: 'application', provider: 'windows-shell', label: 'Editor', target: 'editor.exe',
    metadata: { pid: 42, title: 'Untrusted document title' }, operations: [{ name: 'status', permission: 'read' }, { name: 'launch', permission: 'interact', approval: 'session' }],
  }] })
  const discovered = registry.discover()[0]
  assert.equal(discovered.metadata.title, 'Untrusted document title')
  assert.equal(registry.authorize({ capabilityId: 'application.editor', operation: 'launch' }).decision, 'needs_approval')
})
