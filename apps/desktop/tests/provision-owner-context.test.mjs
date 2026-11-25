import test from 'node:test'
import assert from 'node:assert/strict'
import {resolve,join} from 'node:path'
import {spawnSync} from 'node:child_process'
import {mkdtempSync,rmSync,existsSync,readdirSync} from 'node:fs'

const windows={skip:process.platform!=='win32',timeout:20000}
const script=resolve(import.meta.dirname,'../scripts/provision-private-state.ps1')
const powershell=join(process.env.SystemRoot||'','System32/WindowsPowerShell/v1.0/powershell.exe')
const run=args=>spawnSync(powershell,['-NoProfile','-NonInteractive',...args],{shell:false,windowsHide:true,encoding:'utf8',timeout:15000})

test('actual source guard refuses simulated elevation, foreign owner, service identity and invalid SID',windows,()=>{
  const result=run(['-File',resolve(import.meta.dirname,'provision-owner-context.ps1'),'-ProvisionScript',script])
  assert.equal(result.status,0,result.stderr)
  const evidence=JSON.parse(result.stdout)
  assert.equal(evidence.Passed,true);assert.equal(evidence.Accepted,2);assert.equal(evidence.Rejected,5)
  assert.equal(evidence.StateCreated,false);assert.equal(evidence.SimulatedContexts,true)
})

test('foreign expected SID is refused before inspecting even a nonexistent root',windows,()=>{
  const root=mkdtempSync(join(resolve(import.meta.dirname,'../../../verification'),'.provision-owner-'))
  try{
    const nonexistent=join(root,'never-created')
    const result=run(['-File',script,'-Root',nonexistent,'-Apply','-ExpectedOwnerSid','S-1-5-18'])
    assert.notEqual(result.status,0)
    assert.match(result.stderr,/Expected Nori owner differs/)
    assert.equal(existsSync(nonexistent),false);assert.deepEqual(readdirSync(root),[])
  }finally{rmSync(root,{recursive:true,force:true})}
})

test('actual standard account assertion still permits isolated protected test provisioning',windows,()=>{
  const account=run(['-Command','[Security.Principal.WindowsIdentity]::GetCurrent().User.Value | ConvertTo-Json -Compress'])
  assert.equal(account.status,0,account.stderr)
  const sid=JSON.parse(account.stdout)
  const result=run(['-File',script,'-Root',resolve(import.meta.dirname,'../../..'),'-Apply','-TestOnly','-ExpectedOwnerSid',sid])
  assert.equal(result.status,0,result.stderr)
  assert.match(result.stdout,/ExpectedOwnerMatched\s+: True/)
  assert.match(result.stdout,/OwnerContextElevated\s+: False/)
  assert.match(result.stdout,/OriginalInstallerOwnerVerified\s+: False/)
  assert.match(result.stdout,/TestFolderRemoved\s+: True/)
})
