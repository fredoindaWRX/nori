import assert from 'node:assert/strict'
import test from 'node:test'
import { noriReaLiveAsk, noriReaLiveAskResponse } from '../bridge/rea-tools.mjs'

const OWNER = 'Use your existing REA setup to investigate my G10 mixer, FCC ID 2BG4U-G10. Check whether your available tools support live USB inspection. If they do, inspect the SW Update connection and report its USB ID and interfaces. Keep the inspection read-only. If USB inspection isn’t supported, report the missing capability.'

test('a live USB request through REA gets a plain no that names the missing capability', () => {
  const ask = noriReaLiveAsk(OWNER)
  assert.ok(ask)
  const answer = noriReaLiveAskResponse(ask)
  assert.match(answer, /^No\. My REA setup does not support live USB inspection/)
  assert.match(answer, /Missing capability: a read-only USB device reader/)
  assert.match(answer, /Nothing was read or changed/)
  assert.doesNotMatch(answer, /connection check passed/)
})

test('ordinary REA status, file analysis and non-REA talk are left to their own routes', () => {
  for (const goal of ['Is REA working?', 'Check that REA is connected and show which REA tools Nori can use.',
    'Explain how REA does USB inspection', 'my usb mouse is broken', 'Do not use REA on my USB drive.']) {
    assert.equal(noriReaLiveAsk(goal), null, goal)
  }
  assert.ok(noriReaLiveAsk('Use REA to attach to the running game and watch it.'))
})
