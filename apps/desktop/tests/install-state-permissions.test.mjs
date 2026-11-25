import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { resolve, join } from 'node:path'
import { readdirSync } from 'node:fs'

test('standard Windows token writes private fixture state but cannot alter application/model bytes', {
  skip: process.platform !== 'win32',
}, () => {
  const root = resolve(import.meta.dirname, '../../..')
  const directory = join(root, 'verification')
  const before = readdirSync(directory).filter(name => name.startsWith('.install-state-permissions-')).sort()
  const result = spawnSync(join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe'),
    ['-NoProfile', '-NonInteractive', '-File', resolve(import.meta.dirname, '../scripts/probe-install-state-permissions.ps1'), '-Root', root],
    { encoding: 'utf8', windowsHide: true, shell: false, timeout: 15000 })
  assert.equal(result.status, 0, result.stdout + result.stderr)
  const evidence = JSON.parse(result.stdout)
  for (const key of ['passed', 'privateWritesVerified', 'executableWriteDenied', 'modelWriteDenied', 'privateAclVerified', 'fixtureRemoved'])
    assert.equal(evidence[key], true, key)
  for (const key of ['elevated', 'installedSuiteVerified', 'ownerStateUsed', 'activationAuthorized'])
    assert.equal(evidence[key], false, key)
  assert.deepEqual(readdirSync(directory).filter(name => name.startsWith('.install-state-permissions-')).sort(), before)
})
