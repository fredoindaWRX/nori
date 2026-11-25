// Real synthetic browser continuity, SAME prepared state and loopback origin,
// fresh retained Windows Job per cycle. No owner data or installed activation.
import assert from 'node:assert/strict'
import {createServer} from 'node:http'
import {randomBytes} from 'node:crypto'
import {existsSync,readFileSync,writeFileSync} from 'node:fs'
import {join} from 'node:path'
import {createRequire} from 'node:module'
import {prepareOwnedJobFixture,runOwnedJobFixture,prepareGuardedDesktopRestartState} from './owned-job-fixture.mjs'
const {acquireStateOwner}=createRequire(import.meta.url)('../desktop/state-owner.cjs')
if(process.platform!=='win32'||process.argv.length!==2)throw Error('Explicit Windows guarded restart acceptance takes no arguments')
const fixturePath='/nori-storage-fixture?fixture='+randomBytes(32).toString('hex')
let ownedPageRequests=0
const server=createServer((request,response)=>{
  if(request.url!==fixturePath){response.writeHead(403);response.end();return}
  ownedPageRequests++
  response.writeHead(200,{'Content-Type':'text/html','Cache-Control':'no-store','Content-Security-Policy':"default-src 'none'"})
  response.end('<!doctype html><meta name="nori-synthetic-fixture" content="storage-v1"><title>Synthetic guarded storage</title>')
})
await new Promise((done,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',done)})
const fixtureUrl=`http://127.0.0.1:${server.address().port}${fixturePath}`
const wait=ms=>new Promise(done=>setTimeout(done,ms))
const cycles=[]
try{
  const state=prepareGuardedDesktopRestartState({browserFixtureUrl:fixtureUrl})
  for(let cycle=0;cycle<3;cycle++){
    const fixture=prepareOwnedJobFixture()
    let refusalsAfterAppExit=0
    const result=await runOwnedJobFixture({fixture,mode:'desktop',desktopLayout:'consolidated-v1',desktopRestartState:state,
      timeoutMs:120000,callbackTimeoutMs:120000,
      onReady:async({owner,guardedDirectories,signal,getMembership})=>{
        const path=join(fixture,'desktop-job-acceptance.json'),deadline=Date.now()+100000
        while(!existsSync(path)){
          if(signal.aborted||Date.now()>deadline)throw Error('Guarded restart desktop acceptance deadline')
          await wait(20)
        }
        const acceptance=JSON.parse(readFileSync(path,'utf8')),membership=getMembership()
        assert.equal(acceptance.ready,true);assert.equal(acceptance.cleanup?.desktop_probe_cleanup,'PASS')
        assert.ok(membership);assert.ok(acceptance.nativePids.every(id=>membership.processIds.includes(id)))
        owner.assertHeld();assert.equal(acceptance.migrationDeniedAtReadiness,3)
        assert.ok(guardedDirectories.every(directory=>!existsSync(join(directory,'.nori-state-owner.json'))))
        assert.equal(existsSync(join(fixture,'child-finished.txt')),false,'Delayed writer overlap was not observed')
        for(const directory of guardedDirectories){
          assert.throws(()=>acquireStateOwner(directory,{purpose:'migration'}),{code:'EEXIST'})
          refusalsAfterAppExit++
        }
      }})
    assert.equal(result.ownerReleased,true);assert.equal(result.ownerReleaseError,false)
    assert.equal(result.desktopAccepted,true);assert.equal(result.jobExitProven,true)
    assert.equal(result.result.forced,false);assert.equal(result.sourcesUnchanged,true)
    assert.equal(result.consolidatedPermissionsVerified,true);assert.equal(result.syntheticMarkersPreserved,true)
    assert.equal(result.guardedRestartCycle,cycle);assert.equal(result.browserCookieMode,cycle?'check':'seed')
    assert.equal(refusalsAfterAppExit,3)
    if(cycle){
      assert.equal(result.layoutRoot,cycles[0].result.layoutRoot)
      assert.deepEqual(result.guardedDirectories,cycles[0].result.guardedDirectories)
      assert.equal(result.originalSessionNonce,cycles[0].result.originalSessionNonce)
      assert.deepEqual(result.syntheticMarkerSha256,cycles[0].result.syntheticMarkerSha256)
      assert.deepEqual(result.sourceSha256,cycles[0].result.sourceSha256)
      assert.equal(result.priorReadinessArchive.sha256,cycles[cycle-1].result.capturedReadiness.sha256)
      assert.equal(existsSync(result.priorReadinessArchive.path),true)
    }
    for(const directory of result.guardedDirectories){const migration=acquireStateOwner(directory,{purpose:'migration'});migration.release()}
    cycles.push({result,refusalsAfterAppExit})
    console.log(JSON.stringify({guardedRestartCycle:'PASS',cycle,mode:result.browserCookieMode,
      fixture,layoutRoot:result.layoutRoot,totalProcesses:result.result.totalProcesses}))
  }
  assert.equal(ownedPageRequests,3)
  const evidence=join(cycles[0].result.layoutRoot,'guarded-restarts-receipt.json')
  writeFileSync(evidence,JSON.stringify({schema:1,syntheticOnly:true,cycles,
    stableSyntheticLoopbackOrigin:fixtureUrl,ownedPageRequests,
    browserCookieContinuityVerified:true,localStorageContinuityVerified:true,indexedDbContinuityVerified:true,
    syntheticSettingAndMarkersPreserved:true,exactJobDrainedEveryCycle:true,
    privateAndBrowserPermissionsVerifiedEveryCycle:true,productionActivationVerified:false,releaseVerified:false},null,2),{flag:'wx'})
  console.log(JSON.stringify({guardedDesktopRestarts:'PASS',evidence,cycles:cycles.length,productionActivationVerified:false}))
}finally{
  server.closeAllConnections();await new Promise(done=>server.close(done))
}
