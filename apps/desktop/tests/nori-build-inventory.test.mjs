import {test} from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {inventoryBuilds, summarizeBuilds} from '../scripts/nori-build-inventory.mjs'

test('labels selected build and duplicates without authorizing deletion or changing pointer', () => {
  const root = mkdtempSync(join(tmpdir(), 'nori-inventory-'))
  try {
    writeFileSync(join(root, 'current-desktop.txt'), 'current\r\n')
    mkdirSync(join(root, 'native-desktop-current', 'win-unpacked'), {recursive: true})
    writeFileSync(join(root, 'native-desktop-current', 'win-unpacked', 'Nori.exe'), 'fixture')
    for (const name of ['native-desktop-old', 'native-suite-old', 'native-installer-old', 'private-state']) mkdirSync(join(root, name))
    mkdirSync(join(root, 'native-desktop-old', 'win-unpacked', 'resources', 'NoriSuite', 'state'), {recursive: true})
    writeFileSync(join(root, 'native-desktop-old', 'win-unpacked', 'resources', 'NoriSuite', 'state', 'private.txt'), 'do not read or change')
    const result = inventoryBuilds(root)
    assert.equal(result.selectedExecutablePresent, true)
    assert.deepEqual(result.entries.map(entry => entry.role), ['selected-desktop', 'other-desktop-build', 'installer-build', 'staging-bundle', 'unclassified'])
    assert.equal(result.cleanupQualified, false)
    assert.equal(result.packagedStatePolicy.status, 'no-installed-policy')
    const summary = summarizeBuilds(result)
    assert.match(summary, /Selected build: current/)
    assert.match(summary, /Other desktop builds: 1/)
    assert.match(summary, /No folders are approved for deletion/)
    assert.ok(result.entries.every(entry => entry.deletionAuthorized === false))
    const old = result.entries.find(entry => entry.name === 'native-desktop-old')
    assert.equal(old.stateLocations.find(entry => entry.relativePath === 'win-unpacked/resources/NoriSuite/state').status, 'directory-present')
    assert.equal(readFileSync(join(root, 'native-desktop-old', 'win-unpacked', 'resources', 'NoriSuite', 'state', 'private.txt'), 'utf8'), 'do not read or change')
    assert.equal(readFileSync(join(root, 'current-desktop.txt'), 'utf8'), 'current\r\n')
  } finally { rmSync(root, {recursive: true, force: true}) }
})

test('reports valid and refused package policies without adopting or provisioning state', () => {
  const root = mkdtempSync(join(tmpdir(), 'nori-policy-inventory-'))
  try {
    writeFileSync(join(root, 'current-desktop.txt'), 'current')
    const app = join(root, 'native-desktop-current', 'win-unpacked')
    mkdirSync(app, {recursive: true})
    writeFileSync(join(app, 'Nori.exe'), 'fixture')
    const marker = join(app, 'nori-install-layout.json')
    writeFileSync(marker, JSON.stringify({schema:'nori.installed-state-policy.v1',stateLayout:'consolidated-v1',suiteRelativePath:'resources/NoriSuite'}))
    assert.equal(inventoryBuilds(root).packagedStatePolicy.status, 'consolidated-policy-present')
    assert.equal(inventoryBuilds(root).packagedStatePolicy.preparedStateVerified, false)
    assert.throws(() => readFileSync(join(app, 'resources', 'NoriSuite', 'state')), {code:'ENOENT'})
    writeFileSync(marker, '{')
    assert.equal(inventoryBuilds(root).packagedStatePolicy.status, 'policy-refused')
    assert.equal(readFileSync(marker, 'utf8'), '{')
  } finally { rmSync(root, {recursive:true, force:true}) }
})

test('missing and escaping selection fail closed without selecting another build', () => {
  const root = mkdtempSync(join(tmpdir(), 'nori-inventory-'))
  try {
    mkdirSync(join(root, 'native-desktop-old'))
    assert.equal(inventoryBuilds(root).selectionError, 'Selection pointer missing')
    writeFileSync(join(root, 'current-desktop.txt'), '../old')
    const result = inventoryBuilds(root)
    assert.equal(result.selectionError, 'Invalid selection pointer')
    assert.equal(result.selectedExecutable, null)
    assert.match(summarizeBuilds(result), /MISSING — do not guess another build/)
    assert.ok(result.entries.every(entry => entry.role !== 'selected-desktop'))
    writeFileSync(join(root, 'current-desktop.txt'), 'old')
    assert.equal(inventoryBuilds(root).selectedExecutablePresent, false)
  } finally { rmSync(root, {recursive: true, force: true}) }
})
