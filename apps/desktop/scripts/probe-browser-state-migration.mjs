// Actual Electron cookie continuity through fresh split-copy staging; owner
// AppData and real cookies are never read. All files here are synthetic fixtures.
import assert from 'node:assert/strict'
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,readdirSync,cpSync,unlinkSync} from 'node:fs'
import {join,resolve,basename} from 'node:path'
import {fileURLToPath} from 'node:url'
import {spawn,spawnSync} from 'node:child_process'
import {createServer} from 'node:http'
import {randomBytes,createHash} from 'node:crypto'
import {stageDesktopStateLayout} from './stage-desktop-state-layout.mjs'
import {stageCorePrivateState} from './stage-core-private-state.mjs'
if(process.platform!=='win32')throw Error('Browser migration acceptance requires Windows')
const root=resolve(fileURLToPath(new URL('../../../',import.meta.url))),verification=join(root,'verification')
const sourcePaths=['desktop/main.cjs','desktop/consolidated-state-selection.cjs','desktop/native-state-layout.cjs',
  'desktop/workspace-probe.cjs','desktop/probe-failure.cjs','desktop/native-core.cjs','desktop/native-stack.cjs',
  'scripts/probe-desktop.mjs','scripts/probe-browser-state-migration.mjs','scripts/stage-core-private-state.mjs',
  'scripts/stage-desktop-state-layout.mjs','scripts/desktop-state-split-plan.mjs','scripts/private-state-plan.mjs',
  'scripts/private-state-integrity.mjs','scripts/verify-private-state-acl.ps1','scripts/verify-browser-state-acl.ps1',
  'scripts/browser-capability-sid.ps1']
const sourceHashes=()=>Object.fromEntries(sourcePaths.map(path=>[path,
  createHash('sha256').update(readFileSync(join(root,'apps/desktop',path))).digest('hex')]))
const sourceSha256=sourceHashes()
const fixture=mkdtempSync(join(verification,'.native-browser-migration-'))
const oldProfile=mkdtempSync(join(verification,'.native-desktop-probe-cookie-source-'))
mkdirSync(join(oldProfile,'settings'))
const marker='synthetic native setting preserved across split-copy'
writeFileSync(join(oldProfile,'settings','migration-fixture.txt'),marker)
const fixturePath='/nori-storage-fixture?fixture='+randomBytes(32).toString('hex')
const fixtureServer=createServer((request,response)=>{
  if(request.url!==fixturePath){response.writeHead(403);response.end();return}
  response.writeHead(200,{'Content-Type':'text/html','Cache-Control':'no-store','Content-Security-Policy':"default-src 'none'"})
  response.end('<!doctype html><meta name="nori-synthetic-fixture" content="storage-v1"><title>Synthetic storage acceptance</title>')
})
await new Promise((done,reject)=>{fixtureServer.once('error',reject);fixtureServer.listen(0,'127.0.0.1',done)})
const fixtureUrl=`http://127.0.0.1:${fixtureServer.address().port}${fixturePath}`
async function launch(profile,mode,{layout=false}={}){
  const child=spawn(process.execPath,[fileURLToPath(new URL('./probe-desktop.mjs',import.meta.url)),
    '--once',`${layout?'--layout-fixture':'--profile-fixture'}=${basename(profile)}`,`--browser-cookie=${mode}`],
    {cwd:root,windowsHide:true,shell:false,stdio:['ignore','pipe','pipe'],
      env:{...process.env,NORI_BROWSER_STATE_FIXTURE_URL:fixtureUrl}})
  let stdout='',stderr=''
  child.stdout.on('data',data=>{stdout+=data});child.stderr.on('data',data=>{stderr+=data})
  const timer=setTimeout(()=>child.kill(),100000)
  const result=await new Promise((done,reject)=>{child.once('error',reject);child.once('exit',status=>done({status,stdout,stderr}))})
    .finally(()=>clearTimeout(timer))
  assert.equal(result.status,0,`Browser migration GUI failed: ${result.stderr}`)
  const items=result.stdout.trim().split(/\r?\n/).filter(line=>line.startsWith('{')).map(line=>JSON.parse(line))
  const ready=items.find(item=>item.desktop_probe==='READY'),cleanup=items.find(item=>item.desktop_probe_cleanup)
  assert.ok(ready);assert.equal(ready.summary.renderer.browserCookie.syntheticCookieVerified,true)
  assert.equal(ready.summary.renderer.browserStorage.localStorageVerified,true)
  assert.equal(ready.summary.renderer.browserStorage.indexedDbVerified,true)
  assert.equal(cleanup.exit.code,0);assert.equal(cleanup.desktop_probe_cleanup,'PASS')
  assert.deepEqual(cleanup.ownedProcessesRemaining,[]);assert.equal(cleanup.desktopOwnershipReleased,true)
  assert.equal(cleanup.browserOwnershipReleased,true)
  assert.equal(cleanup.coreOwnershipReleased,true)
  if(layout){
    assert.equal(ready.summary.consolidatedStateSelected,true)
    assert.equal(ready.summary.privateProfile,join(profile,'state/private/desktop'))
    assert.equal(ready.summary.browserSession,join(profile,'state/browser'))
    assert.equal(ready.summary.selectedCoreState,join(profile,'state/private/core'))
  }else assert.equal(ready.summary.consolidatedStateSelected,false)
  return {ready,cleanup}
}
try{
const original=await launch(oldProfile,'seed')
// Reconstruct a legacy mixed profile only from our cleanly closed generated
// native and browser fixtures. No collision overwrite or symlink dereference.
const legacy=join(fixture,'synthetic-legacy-profile');mkdirSync(legacy)
for(const directory of [oldProfile,original.ready.summary.browserSession]){
  for(const name of readdirSync(directory)){
    if(['desktop-readiness.json','desktop-failure.json','.nori-state-owner.json'].includes(name))continue
    // The synthetic Core was explicitly run below oldProfile/core. Stage it
    // separately into the fixed Core destination, not as desktop private data.
    if(directory===oldProfile&&name==='core')continue
    cpSync(join(directory,name),join(legacy,name),{recursive:true,errorOnExist:true,force:false,dereference:false})
  }
}
const staging=stageDesktopStateLayout(fixture,legacy)
assert.equal(staging.privateAclVerified,true);assert.equal(staging.browserInitialPrivateAclVerified,true)
const coreStaging=stageCorePrivateState(fixture,join(oldProfile,'core'))
assert.equal(coreStaging.protectedAclVerified,true)
const newProfile=join(fixture,'state/private/desktop')
const newBrowser=join(fixture,'state/browser')
function verifyBrowserAcl(){
  const browserAcl=spawnSync(join(process.env.SystemRoot,'System32/WindowsPowerShell/v1.0/powershell.exe'),
    ['-NoProfile','-File',fileURLToPath(new URL('./verify-browser-state-acl.ps1',import.meta.url)),'-Root',newBrowser],
    {encoding:'utf8',windowsHide:true,shell:false,timeout:30000})
  assert.equal(browserAcl.error,undefined);assert.equal(browserAcl.status,0,'Browser sandbox ACL policy check failed')
}
const sessions=[]
for(let cycle=0;cycle<2;cycle++){
  if(cycle)unlinkSync(join(newProfile,'desktop-readiness.json'))
  verifyBrowserAcl()
  sessions.push(await launch(fixture,'check',{layout:true}))
  assert.equal(readFileSync(join(newProfile,'settings','migration-fixture.txt'),'utf8'),marker)
  const acl=spawnSync(join(process.env.SystemRoot,'System32/WindowsPowerShell/v1.0/powershell.exe'),
    ['-NoProfile','-File',fileURLToPath(new URL('./verify-private-state-acl.ps1',import.meta.url)),'-Root',join(fixture,'state/private')],
    {encoding:'utf8',windowsHide:true,shell:false,timeout:30000})
  assert.equal(acl.error,undefined);assert.equal(acl.status,0,'Native private profile ACL changed after browser migration')
  verifyBrowserAcl()
}
assert.equal(readFileSync(join(legacy,'settings','migration-fixture.txt'),'utf8'),marker)
assert.deepEqual(sourceHashes(),sourceSha256,'Acceptance source changed during this run; results not revision-qualified')
const evidence=join(fixture,'browser-migration-receipt.json')
writeFileSync(evidence,JSON.stringify({schema:1,syntheticOnly:true,sourceSha256,sourceUnchangedDuringAcceptance:true,staging,coreStaging,original,sessions,
  consolidatedStateSelectedOnBothLaunches:true,destinationStateNotRelocated:true,
  coreSourceMapping:'explicit generated oldProfile/core; not inferred from owner legacy state',
  privateProfileAclVerifiedAfterBothLaunches:true,cookieContinuityVerified:true,
  localStorageContinuityVerified:true,indexedDbContinuityVerified:true,stableSyntheticLoopbackOriginUsed:true,
  browserRuntimeAclPolicyVerified:true,browserAclVerifiedBeforeAndAfterBothLaunches:true,sharedChromiumNetworkCapabilityAcknowledged:true,
  sourcePreserved:true,productionActivationVerified:false,releaseVerified:false},null,2),{flag:'wx'})
console.log(JSON.stringify({browserCookieMigration:'PASS',localStorageMigration:'PASS',indexedDbMigration:'PASS',
  evidence,cycles:sessions.length,productionActivationVerified:false}))
}finally{
  fixtureServer.closeAllConnections()
  await new Promise(done=>fixtureServer.close(done))
}
