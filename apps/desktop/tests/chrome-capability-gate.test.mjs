import test from 'node:test'
import assert from 'node:assert/strict'
import { chromeWritesGranted } from '../bridge/chrome.mjs'
import { createHostCapabilityRegistry, standardHostCapabilities } from '../bridge/host-capability-registry.mjs'

test('Chrome side-effect tools remain hidden unless the existing gate is enabled', () => {
  assert.equal(chromeWritesGranted({ allowWrites: false }), false)
  assert.equal(chromeWritesGranted({ allowWrites: true }), true)
})

test('Chrome side-effect tools remain hidden when the shared capability is unavailable', () => {
  const registry = createHostCapabilityRegistry({ descriptors: [{ ...standardHostCapabilities()[0], status: 'disabled' }] })
  assert.equal(chromeWritesGranted({ allowWrites: true, capabilityRegistry: registry }), false)
  assert.equal(registry.events().at(-1).reason, 'capability_unavailable')
})
