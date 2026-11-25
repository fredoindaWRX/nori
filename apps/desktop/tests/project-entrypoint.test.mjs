import {test} from 'node:test'
import assert from 'node:assert/strict'
import {spawnSync} from 'node:child_process'
import {resolve, join} from 'node:path'

test('project launcher delegates selected-package inspection and refuses extra arguments', {skip: process.platform !== 'win32'}, () => {
  const host = join(process.env.SystemRoot, 'System32', 'cscript.exe')
  const project = resolve(import.meta.dirname, '../../..')
  const invoke = (file, args) => spawnSync(host, ['//nologo', file, ...args], {encoding: 'utf8', timeout: 10000, windowsHide: true})
  const root = invoke(join(project, 'Nori.vbs'), ['--inspect'])
  const selected = invoke(join(project, 'apps/desktop/scripts/launch-current-desktop.vbs'), ['--inspect'])
  assert.equal(root.status, selected.status)
  assert.equal(root.stdout.trim(), selected.stdout.trim())
  if (selected.status === 0) {
    assert.match(selected.stdout.trim(), /\\release\\native-desktop-[a-z0-9-]+\\win-unpacked\\Nori\.exe$/i)
  } else {
    assert.equal(selected.status, 1)
    assert.match(selected.stdout, /current N\.O\.R\.I\. desktop executable is missing/i)
  }
  assert.equal(invoke(join(project, 'Nori.vbs'), ['--unknown']).status, 2)
  assert.equal(invoke(join(project, 'Nori.vbs'), ['--inspect', '--writes']).status, 2)
})
