import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'

test('native installer candidate selects explicit build and preserves private state',()=>{
  const source=readFileSync(new URL('../native-suite-installer.iss',import.meta.url),'utf8')
  assert.match(source,/#ifndef NativeDesktopRoot/)
  assert.match(source,/#ifndef NativeInstallerOutput/)
  assert.match(source,/DefaultDirName=\{autopf\}\\Nori/)
  assert.match(source,/Uninstallable=yes/)
  assert.match(source,/AppModifyPath=.*--manage-installation/)
  assert.match(source,/Excludes:.*verification.*state/)
  assert.match(source,/Flags:.*runasoriginaluser/)
  assert.doesNotMatch(source,/Permissions:\s*users-modify|\[UninstallDelete\]|RebaseVenv|suite-payload|model-store/)
})

test('native installer uses extended paths for payload IO without changing app identity',()=>{
  const source=readFileSync(new URL('../native-suite-installer.iss',import.meta.url),'utf8')
  assert.ok(source.includes('DestDir: "\\\\?\\{app}"'))
  assert.ok(source.includes('Filename: "{app}\\Nori.exe"'))
  assert.ok(source.includes('DefaultDirName={autopf}\\Nori'))
  assert.doesNotMatch(source,/Excludes:.*(?:licenses|third_party|composable_kernel)/)
})
