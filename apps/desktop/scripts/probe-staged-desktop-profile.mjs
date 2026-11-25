// Real GUI acceptance using ONLY newly created synthetic private state.
import assert from 'node:assert/strict'
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,existsSync,renameSync,unlinkSync} from 'node:fs'
import {join,resolve} from 'node:path'
import {fileURLToPath} from 'node:url'
import {spawnSync} from 'node:child_process'
import {stageDesktopPrivateState} from './stage-core-private-state.mjs'
if(process.platform!=='win32')throw Error('Protected desktop acceptance requires Windows')
const root=resolve(fileURLToPath(new URL('../../../',import.meta.url)))
const verification=join(root,'verification')
const fixture=mkdtempSync(join(verification,'.native-profile-staging-'))
const source=join(fixture,'synthetic-old-profile')
mkdirSync(source);mkdirSync(join(source,'settings'));mkdirSync(join(source,'Cache'))
const marker='synthetic durable profile marker; no owner data'
writeFileSync(join(source,'settings','migration-fixture.txt'),marker)
writeFileSync(join(source,'Cache','migration-fixture.txt'),'synthetic disposable cache')
const staging=stageDesktopPrivateState(fixture,source)
assert.equal(staging.protectedAclVerified,true)
assert.equal(staging.activationAuthorized,false)
// Relocate only our fresh synthetic staged directory on this same volume.
// Production activation is intentionally not provided by this harness.
const profileName=`.native-desktop-probe-staged-${fixture.split(/[\\/]/).at(-1).slice('.native-profile-staging-'.length)}`
const profile=join(verification,profileName)
assert.equal(existsSync(profile),false)
renameSync(join(fixture,'state/private/desktop'),profile)
const powershell=join(process.env.SystemRoot,'System32/WindowsPowerShell/v1.0/powershell.exe')
function acl(){
  const result=spawnSync(powershell,['-NoProfile','-File',fileURLToPath(new URL('./verify-private-state-acl.ps1',import.meta.url)),'-Root',profile],
    {encoding:'utf8',windowsHide:true,shell:false,timeout:30000})
  assert.equal(result.error,undefined)
  return result.status===0
}
const sessions=[]
for(let cycle=0;cycle<2;cycle++){
  const privateAclBeforeBoot=acl()
  if(cycle===0)assert.equal(privateAclBeforeBoot,true,'Staged synthetic profile was not protected before first launch')
  const result=spawnSync(process.execPath,[fileURLToPath(new URL('./probe-desktop.mjs',import.meta.url)),
    '--once',`--profile-fixture=${profileName}`],{cwd:root,encoding:'utf8',windowsHide:true,shell:false,timeout:100000})
  assert.equal(result.error,undefined,'Desktop acceptance runner failed')
  assert.equal(result.status,0,`Desktop acceptance failed: ${result.stderr}`)
  const lines=result.stdout.trim().split(/\r?\n/).filter(line=>line.startsWith('{')).map(line=>JSON.parse(line))
  const ready=lines.find(line=>line.desktop_probe==='READY'),cleanup=lines.find(line=>line.desktop_probe_cleanup)
  assert.ok(ready);assert.equal(cleanup.desktop_probe_cleanup,'PASS')
  assert.equal(ready.summary.privateProfile,profile)
  assert.notEqual(ready.summary.browserSession,profile)
  assert.equal(resolve(ready.summary.browserSession,'..'),verification)
  assert.ok(existsSync(join(ready.summary.browserSession,'Network')),'Browser network data did not use separated session root')
  assert.equal(cleanup.desktopOwnershipVerified,true);assert.equal(cleanup.desktopOwnershipReleased,true)
  assert.equal(cleanup.exit.code,0);assert.deepEqual(cleanup.ownedProcessesRemaining,[])
  assert.equal(readFileSync(join(profile,'settings','migration-fixture.txt'),'utf8'),marker)
  assert.equal(readFileSync(join(source,'settings','migration-fixture.txt'),'utf8'),marker)
  assert.equal(readFileSync(join(source,'Cache','migration-fixture.txt'),'utf8'),'synthetic disposable cache')
  const privateAclAfterBoot=acl()
  sessions.push({ready,cleanup,privateAclBeforeBoot,privateAclAfterBoot})
  // Remove only the readiness receipt we just verified in this generated fixture.
  if(cycle===0)unlinkSync(join(profile,'desktop-readiness.json'))
}
const protectedAclVerifiedBeforeAndAfterEachBoot=sessions.every(session=>session.privateAclBeforeBoot&&session.privateAclAfterBoot)
const receipt={schema:1,syntheticOnly:true,staging,relocatedSyntheticProfile:profile,
  protectedAclVerifiedBeforeAndAfterEachBoot,durableSyntheticMarkerPreserved:true,
  originalSyntheticProfilePreserved:true,sessions,productionActivationVerified:false,releaseVerified:false}
const evidence=join(fixture,'staged-desktop-restart-receipt.json')
writeFileSync(evidence,JSON.stringify(receipt,null,2),{flag:'wx'})
console.log(JSON.stringify({stagedDesktopRestart:'PASS',fullPrivateProfileAcceptance:protectedAclVerifiedBeforeAndAfterEachBoot?'PASS':'FAIL',
  evidence,profile,cycles:sessions.length,productionActivationVerified:false}))
if(!protectedAclVerifiedBeforeAndAfterEachBoot)process.exitCode=1
