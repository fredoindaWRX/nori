// Explicit real GUI/GPU acceptance. No live profile, install or sensor capture.
import {existsSync,readFileSync} from 'node:fs'
import {join} from 'node:path'
import {createRequire} from 'node:module'
import {prepareOwnedJobFixture,runOwnedJobFixture} from './owned-job-fixture.mjs'
const {acquireStateOwner}=createRequire(import.meta.url)('../desktop/state-owner.cjs')
if(process.platform!=='win32')throw Error('Desktop Job acceptance requires Windows')
const consolidated=process.argv.includes('--consolidated')
if(process.argv.slice(2).some(argument=>argument!=='--consolidated'))throw Error('Unknown explicit desktop Job acceptance argument')
const fixture=prepareOwnedJobFixture()
const wait=ms=>new Promise(done=>setTimeout(done,ms))
let migrationHeldBeyondAppExit=false,migrationScopesAfterAppExit=0
const result=await runOwnedJobFixture({fixture,mode:'desktop',desktopLayout:consolidated?'consolidated-v1':'isolated-v1',timeoutMs:120000,callbackTimeoutMs:120000,
  onReady:async({state,owner,guardedDirectories,signal,getMembership})=>{
    const path=join(fixture,'desktop-job-acceptance.json'),deadline=Date.now()+100000
    while(!existsSync(path)){
      if(signal.aborted||Date.now()>deadline)throw Error('Actual desktop Job acceptance deadline')
      await wait(50)
    }
    const acceptance=JSON.parse(readFileSync(path,'utf8'))
    if(!acceptance.ready||acceptance.cleanup?.desktop_probe_cleanup!=='PASS')throw Error('Actual desktop session did not qualify')
    const membership=getMembership()
    if(!membership||!acceptance.nativePids.every(id=>membership.processIds.includes(id)))
      throw Error('Native desktop/Core/runtime/engine were not proven members of the exact Job')
    owner.assertHeld()
    if(state!==acceptance.profile||acceptance.migrationDeniedAtReadiness!==3)throw Error('Three readiness migration refusals were not demonstrated')
    if(guardedDirectories.some(directory=>existsSync(join(directory,'.nori-state-owner.json'))))
      throw Error('An ordinary desktop/browser/Core owner has not released')
    if(existsSync(join(fixture,'child-finished.txt')))throw Error('Delayed descendant already exited; overlap not demonstrated')
    for(const directory of guardedDirectories){
      try{const invalid=acquireStateOwner(directory,{purpose:'migration'});invalid.release();throw Error('Migration bypassed live teardown guard')}
      catch(error){if(error.code!=='EEXIST')throw error;migrationScopesAfterAppExit++}
    }
    migrationHeldBeyondAppExit=true
  }})
if(!result.desktopAccepted||!result.jobExitProven||!result.ownerReleased||!result.sourcesUnchanged||
  !migrationHeldBeyondAppExit||!result.syntheticMarkersPreserved||
  (consolidated&&!result.consolidatedPermissionsVerified))throw Error('Desktop Job drain/release acceptance incomplete')
for(const directory of result.guardedDirectories){const migration=acquireStateOwner(directory,{purpose:'migration'});migration.release()}
console.log(JSON.stringify({desktopOwnedJob:'PASS',fixture,profile:result.profile,
  desktopLayout:result.desktopLayout,consolidatedPermissionsVerified:result.desktopLayout==='consolidated-v1'?result.consolidatedPermissionsVerified:undefined,
  syntheticMarkersPreserved:result.syntheticMarkersPreserved,
  exactJobEmpty:true,totalProcesses:result.result.totalProcesses,migrationHeldBeyondAppExit,migrationScopesAfterAppExit,
  guardedDirectoriesReleased:result.guardedDirectories.length,productionActivated:false,releaseVerified:false}))
