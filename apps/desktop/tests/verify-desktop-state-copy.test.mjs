import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, copyFileSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { verifyDesktopStateCopy } from '../scripts/verify-desktop-state-copy.mjs'
import { desktopStateSplitPlan } from '../scripts/desktop-state-split-plan.mjs'

test('read-only split verification detects stale settings, browser corruption and extra destination entries', () => {
  const root = mkdtempSync(join(tmpdir(), 'nori-split-reverify-'))
  const source = join(root, 'original')
  const privateRoot = join(root, 'state/private/desktop')
  const browserRoot = join(root, 'state/browser')
  try {
    for (const path of [source, privateRoot, browserRoot]) mkdirSync(path, { recursive: true })
    writeFileSync(join(source, 'settings.json'), 'original')
    writeFileSync(join(source, 'Preferences'), 'browser1')
    copyFileSync(join(source, 'settings.json'), join(privateRoot, 'settings.json'))
    copyFileSync(join(source, 'Preferences'), join(browserRoot, 'Preferences'))
    assert.throws(() => desktopStateSplitPlan(root, source), /destination preserved/)
    assert.throws(() => desktopStateSplitPlan(root, source, { inspectExistingDestination: 'yes' }), /boolean/)
    const result = verifyDesktopStateCopy(root, source)
    assert.equal(result.privateFiles, 1)
    assert.equal(result.browserFiles, 1)
    assert.equal(result.activationAuthorized, false)
    assert.equal(result.stateChanged, false)
    writeFileSync(join(source, 'settings.json'), 'modified')
    assert.throws(() => verifyDesktopStateCopy(root, source), /integrity mismatch/)
    assert.equal(readFileSync(join(privateRoot, 'settings.json'), 'utf8'), 'original')
    copyFileSync(join(source, 'settings.json'), join(privateRoot, 'settings.json'))
    writeFileSync(join(browserRoot, 'Preferences'), 'browser2')
    assert.throws(() => verifyDesktopStateCopy(root, source), /integrity mismatch/)
    copyFileSync(join(source, 'Preferences'), join(browserRoot, 'Preferences'))
    writeFileSync(join(browserRoot, 'extra'), 'unexpected')
    assert.throws(() => verifyDesktopStateCopy(root, source), /inventory differs/)
  } finally { rmSync(root, { recursive: true, force: true }) }
})
