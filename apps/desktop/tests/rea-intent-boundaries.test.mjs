import test from 'node:test'
import assert from 'node:assert/strict'
import { requestsNoriRea, requestsNoriReaSetup, requestedNoriReaTarget } from '../bridge/rea-tools.mjs'

// Intentionally nonexistent: these tests exercise binding/intent, never REA,
// a target process, a model, or a user-owned artifact.
const target = String.raw`C:\Nori\__synthetic_missing_rea_route_target__.exe`

test('ordinary REA requests retain one quoted Windows path as data binding', () => {
  for (const quote of ['"', "'", '`']) {
    const goal = `Use REA to inspect ${quote}${target}${quote} read-only.`
    assert.equal(requestsNoriRea(goal), true, goal)
    assert.equal(requestsNoriReaSetup(goal), false, goal)
    const binding = requestedNoriReaTarget(goal)
    assert.equal(binding.needsPath, false, goal)
    assert.match(binding.invalid, /ENOENT/, 'path was recognized and checked, not stripped as command text')
  }
  assert.equal(requestedNoriReaTarget('What is REA?').needsPath, true)
  assert.equal(requestsNoriRea('Use my app tools'), false)
})

test('negated REA and analysis requests cannot authorize deterministic dispatch', () => {
  for (const goal of [`Do not use REA to inspect "${target}"`,
    `Don’t use REA to inspect "${target}"`, `Never inspect "${target}" with REA`,
    `Avoid using REA to analyze "${target}"`, `Use REA to inspect "${target}". Do not inspect it.`,
    `Use REA to inspect "${target}". Don't do it.`, 'Do not configure REA.',
    'Never check whether REA is working.']) {
    assert.equal(requestsNoriRea(goal), false, goal)
    assert.equal(requestsNoriReaSetup(goal), false, goal)
    assert.equal(requestedNoriReaTarget(goal), null, goal)
  }
})

test('quoted examples and code are not authority and cannot smuggle nested target paths', () => {
  for (const goal of [`Explain this sentence: 'Use REA to inspect "${target}"'`,
    `The example is 'Use REA to inspect "${target}"'`,
    `The example is “Use REA to inspect '${target}'”`,
    `The example is \`Use REA to inspect "${target}"\``,
    `Example:\n\`\`\`\nUse REA to inspect "${target}"\n\`\`\``,
    `Example:\n> Use REA to inspect "${target}"`,
    'The instructions say "Check whether REA is working".']) {
    assert.equal(requestsNoriRea(goal), false, goal)
    assert.equal(requestsNoriReaSetup(goal), false, goal)
    assert.equal(requestedNoriReaTarget(goal), null, goal)
  }
  assert.equal(requestedNoriReaTarget(`Use REA to inspect the target mentioned in 'Example "${target}"'`).needsPath, true)
})

test('unrelated read-only constraints do not negate the authorized inspection', () => {
  for (const constraint of ['Do not modify the target.', 'Do not launch the target.',
    'Do not use the web.', 'Never delete files.']) {
    const goal = `Use REA to inspect "${target}". ${constraint}`
    assert.equal(requestsNoriRea(goal), true, goal)
    assert.equal(requestedNoriReaTarget(goal).needsPath, false, goal)
  }
  assert.equal(requestsNoriRea(`Use REA to inspect "${target}". The documentation says "Do not use REA".`), true)
})

test('discussion stays inert while positive status/connection requests remain supported', () => {
  for (const goal of [`How can I use REA to inspect "${target}"?`,
    `Tell me how to use REA to inspect "${target}"`, 'Explain how to configure REA.']) {
    assert.equal(requestsNoriRea(goal), false, goal)
    assert.equal(requestsNoriReaSetup(goal), false, goal)
  }
  assert.equal(requestsNoriReaSetup('Check that REA is connected and show which REA tools Nori can use.'), true)
  assert.equal(requestsNoriReaSetup('Is REA working?'), true)
  assert.equal(requestsNoriRea(`Can you use REA to inspect "${target}"?`), true)
})

test('multiple targets and missing quoted bindings cannot silently select the first target', () => {
  assert.match(requestedNoriReaTarget(`Use REA to inspect "${target}" and "C:\\Nori\\other.exe"`).invalid, /multiple target paths/)
  assert.equal(requestedNoriReaTarget(`Use REA to inspect ${target}`).needsPath, true)
  assert.equal(requestsNoriRea('Use REA to inspect ' + 'a'.repeat(20000)), false)
})
