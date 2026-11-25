import test from 'node:test'
import assert from 'node:assert/strict'
import {spawnSync} from 'node:child_process'
import {fileURLToPath} from 'node:url'

test('profile reuse rejects nonisolated paths and incompatible probe modes before starting Electron',()=>{
  const script=fileURLToPath(new URL('../scripts/probe-desktop.mjs',import.meta.url))
  for(const args of [
    ['--once','--profile-fixture=../owner-profile'],
    ['--once','--profile-fixture=C:\\Users\\Studio\\AppData\\Local\\Nori'],
    ['--profile-fixture=.native-desktop-probe-fixture'],
    ['--once','--packaged','--profile-fixture=.native-desktop-probe-fixture'],
    ['--once','--quit-during-startup','--profile-fixture=.native-desktop-probe-fixture'],
  ]){
    const result=spawnSync(process.execPath,[script,...args],{encoding:'utf8',shell:false,windowsHide:true,timeout:10000})
    assert.equal(result.error,undefined)
    assert.equal(result.status,1)
    assert.match(result.stderr,/Profile reuse requires/)
    assert.equal(result.stdout,'')
  }
})
test('GPT-OSS probe is restricted to a packaged launch and cannot interrupt startup',()=>{
  const script=fileURLToPath(new URL('../scripts/probe-desktop.mjs',import.meta.url))
  for(const args of [['--gpt-oss'],['--gpt-oss','--once'],
    ['--gpt-oss','--once','--packaged','--quit-during-startup']]){
    const result=spawnSync(process.execPath,[script,...args],{encoding:'utf8',shell:false,windowsHide:true,timeout:10000})
    assert.equal(result.error,undefined)
    assert.equal(result.status,1)
    assert.match(result.stderr,/GPT-OSS probe requires/)
    assert.equal(result.stdout,'')
  }
})
test('cookie continuity fixtures reject packaged, interactive, early-quit and unknown modes',()=>{
  const script=fileURLToPath(new URL('../scripts/probe-desktop.mjs',import.meta.url))
  for(const args of [['--browser-cookie=seed'],['--once','--packaged','--browser-cookie=check'],
    ['--once','--quit-during-startup','--browser-cookie=seed'],['--once','--browser-cookie=invalid']]){
    const result=spawnSync(process.execPath,[script,...args],{encoding:'utf8',shell:false,windowsHide:true,timeout:10000})
    assert.equal(result.error,undefined);assert.equal(result.status,1)
    assert.match(result.stderr,/Browser cookie acceptance requires/);assert.equal(result.stdout,'')
  }
})
