import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
test('native desktop packaging selects consolidated Electron and native payload only',()=>{
  const config=readFileSync(new URL('../electron-builder.native.yml',import.meta.url),'utf8')
  assert.match(config,/electronDist: \.\.\/\.\.\/runtime\/electron\/v44\.4\.5/)
  assert.match(config,/from: release\/native-suite-current\/NoriSuite/)
  assert.match(config,/output: release\/native-desktop-current/)
  assert.match(config,/!state\{,\/\*\*\/\*\}/)
  assert.match(config,/!verification\{,\/\*\*\/\*\}/)
  assert.match(config,/!native-payload-receipt\.json/)
  assert.doesNotMatch(config,/ollama|suite-payload\/model-store|deep-model-store|\.venv/)
})
