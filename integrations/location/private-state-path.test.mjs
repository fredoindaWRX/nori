import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,mkdirSync,rmSync,existsSync,copyFileSync,writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {fileURLToPath} from 'node:url'
import {spawnSync} from 'node:child_process'

test('packaged verification refuses an absent integration probe before touching credentials',
  {skip:process.platform!=='win32'},()=>{
    const root=mkdtempSync(join(tmpdir(),'nori-location-probe-gate-'))
    const scripts=join(root,'integrations/location'),local=join(root,'local')
    mkdirSync(scripts,{recursive:true});mkdirSync(local)
    try {
      for(const name of ['launch-private.ps1','private-state-path.ps1'])
        copyFileSync(fileURLToPath(new URL('./'+name,import.meta.url)),join(scripts,name))
      writeFileSync(join(scripts,'runtime-path.ps1'),"function Resolve-NoriLocationRuntime { return 'unused.exe' }")
      const result=spawnSync('powershell.exe',['-NoProfile','-File',join(scripts,'launch-private.ps1'),
        '-VerifyNative'],{encoding:'utf8',timeout:10000,windowsHide:true,
        env:{...process.env,LOCALAPPDATA:local}})
      assert.notEqual(result.status,0)
      assert.match(result.stderr,/integration probe is not included/)
      assert.equal(existsSync(join(local,'Nori/location-private')),false)
    } finally {rmSync(root,{recursive:true,force:true})}
})
test('explicit location state resolves inside Nori and never falls back on invalid paths',
  {skip:process.platform!=='win32'},()=>{
    const root=mkdtempSync(join(tmpdir(),'nori-location-path-'))
    const helper=fileURLToPath(new URL('./private-state-path.ps1',import.meta.url))
    const state=join(root,'state/private/desktop');mkdirSync(state,{recursive:true})
    const quote=value=>"'"+value.replaceAll("'","''")+"'"
    const run=target=>spawnSync('powershell.exe',['-NoProfile','-Command',
      "$ErrorActionPreference='Stop'; . "+quote(helper)+'; Resolve-NoriLocationCredentialRoot -NoriRoot '+quote(root)+' -StateRoot '+quote(target)],
      {encoding:'utf8',timeout:10000,windowsHide:true})
    try {
      const valid=run(state)
      assert.equal(valid.status,0,valid.stderr)
      assert.equal(valid.stdout.trim(),join(state,'location-private'))
      for(const target of [root,'relative-state',join(root,'state/private/missing')]) {
        const result=run(target);assert.notEqual(result.status,0)
        assert.equal(result.stdout.trim(),'')
      }
      assert.equal(existsSync(join(state,'location-private')),false)
    } finally {rmSync(root,{recursive:true,force:true})}
})
test('consolidated receiver launch refuses to generate replacement pairing credentials',
  {skip:process.platform!=='win32'},()=>{
    const root=mkdtempSync(join(tmpdir(),'nori-location-no-reset-'))
    const scripts=join(root,'integrations/location'),state=join(root,'state/private/desktop')
    mkdirSync(scripts,{recursive:true});mkdirSync(state,{recursive:true})
    try {
      for(const name of ['launch-private.ps1','private-state-path.ps1'])
        copyFileSync(fileURLToPath(new URL('./'+name,import.meta.url)),join(scripts,name))
      const result=spawnSync('powershell.exe',['-NoProfile','-File',join(scripts,'launch-private.ps1'),
        '-StateRoot',state,'-InitializeOnly'],{encoding:'utf8',timeout:10000,windowsHide:true})
      assert.notEqual(result.status,0)
      assert.match(result.stderr,/Consolidated pairing credentials are missing/)
      assert.equal(existsSync(join(state,'location-private')),false)
    } finally {rmSync(root,{recursive:true,force:true})}
})
