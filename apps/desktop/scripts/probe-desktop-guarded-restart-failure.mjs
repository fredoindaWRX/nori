// Actual synthetic loss/interruption. Failed state is deliberately preserved;
// this script has no recovery, lease stealing or personal profile path.
import assert from 'node:assert/strict'
import {createServer} from 'node:http'
import {randomBytes,createHash} from 'node:crypto'
import {existsSync,readFileSync,writeFileSync,lstatSync} from 'node:fs'
import {join} from 'node:path'
import {fileURLToPath} from 'node:url'
import {prepareOwnedJobFixture,runOwnedJobFixture,prepareGuardedDesktopRestartState} from './owned-job-fixture.mjs'
if(process.platform!=='win32'||process.argv.length!==2)throw Error('Explicit Windows failed guarded restart acceptance takes no arguments')
const ownSource=fileURLToPath(import.meta.url)
const hash=path=>createHash('sha256').update(readFileSync(path)).digest('hex')
const ownSourceSha256=hash(ownSource),wait=ms=>new Promise(done=>setTimeout(done,ms))
const scenarios=[]
for(const scenario of ['local-storage-loss','control-interruption']){
  const fixturePath='/nori-storage-fixture?fixture='+randomBytes(32).toString('hex')
  let erase=false,ownedPageRequests=0
  const server=createServer((request,response)=>{
    if(request.url!==fixturePath){response.writeHead(403);response.end();return}
    ownedPageRequests++
    response.writeHead(200,{'Content-Type':'text/html','Cache-Control':'no-store',
      'Content-Security-Policy':erase?"default-src 'none'; script-src 'unsafe-inline'":"default-src 'none'"})
    // Only our fixed synthetic key is removed, at the SAME owned origin. This
    // proves check-mode detects real missing storage instead of reseeding it.
    response.end('<!doctype html><meta name="nori-synthetic-fixture" content="storage-v1">'+
      (erase?'<script>localStorage.removeItem("nori.migration.synthetic")</script>':''))
  })
  await new Promise((done,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',done)})
  try{
    const fixtureUrl=`http://127.0.0.1:${server.address().port}${fixturePath}`
    const state=prepareGuardedDesktopRestartState({browserFixtureUrl:fixtureUrl})
    const seeded=await runOwnedJobFixture({fixture:prepareOwnedJobFixture(),mode:'desktop',desktopLayout:'consolidated-v1',
      desktopRestartState:state,timeoutMs:120000,callbackTimeoutMs:120000})
    assert.equal(seeded.ownerReleased,true);assert.equal(seeded.desktopAccepted,true)
    assert.equal(seeded.browserCookieMode,'seed');assert.equal(seeded.result.forced,false)
    assert.equal(seeded.sourcesUnchanged,true)
    const failedFixture=prepareOwnedJobFixture()
    erase=scenario==='local-storage-loss'
    let interruptedAfterRealReadiness=false
    const failed=await runOwnedJobFixture({fixture:failedFixture,mode:'desktop',desktopLayout:'consolidated-v1',
      desktopRestartState:state,timeoutMs:120000,callbackTimeoutMs:120000,
      ...(scenario==='control-interruption'?{onReady:async({child,signal,getMembership})=>{
        const deadline=Date.now()+100000
        while(!getMembership()){
          if(signal.aborted||Date.now()>deadline)throw Error('Actual interruption readiness deadline')
          await wait(10)
        }
        const readiness=JSON.parse(readFileSync(join(seeded.profile,'desktop-readiness.json'),'utf8'))
        assert.equal(readiness.renderer.browserCookie.mode,'check')
        assert.equal(readiness.renderer.browserStorage.localStorageVerified,true)
        assert.equal(readiness.renderer.browserStorage.indexedDbVerified,true)
        assert.equal(readiness.runtime.backend,'norama-independent')
        const native=[readiness.runtime.corePid,readiness.runtime.runtimePid,readiness.runtime.workerPid]
        assert.ok(native.every(pid=>getMembership().processIds.includes(pid)))
        interruptedAfterRealReadiness=true;child.stdin.end()
      }}:{})})
    assert.equal(failed.browserCookieMode,'check');assert.equal(failed.guardedRestartCycle,1)
    assert.equal(failed.ownerReleased,false);assert.equal(failed.ownerRecordPreserved,true)
    assert.equal(failed.jobExitProven,true);assert.equal(failed.sourcesUnchanged,true)
    if(scenario==='local-storage-loss'){
      assert.equal(failed.desktopAccepted,false);assert.equal(failed.desktopAcceptance.ready,false)
      assert.equal(failed.result.rootExitCode,1);assert.equal(failed.result.forced,false)
      const failurePath=join(seeded.profile,'desktop-failure.json')
      assert.equal(existsSync(failurePath),true)
      const failure=JSON.parse(readFileSync(failurePath,'utf8'))
      assert.match(JSON.stringify(failure),/localStorage continuity failed/)
    }else{
      assert.equal(interruptedAfterRealReadiness,true);assert.equal(failed.result.forced,true)
      assert.equal(failed.result.forceReason,'control-closed')
    }
    const preservedPaths=[...failed.guardedDirectories.map(directory=>join(directory,'.nori-state-guardian.json')),
      ...['desktop-readiness.json','desktop-failure.json'].map(name=>join(seeded.profile,name)).filter(existsSync)]
    for(const path of preservedPaths)assert.equal(lstatSync(path).isSymbolicLink(),false)
    const preservedSha256=Object.fromEntries(preservedPaths.map(path=>[path,hash(path)]))
    const refusedFixture=prepareOwnedJobFixture()
    await assert.rejects(runOwnedJobFixture({fixture:refusedFixture,mode:'desktop',desktopLayout:'consolidated-v1',
      desktopRestartState:state,timeoutMs:120000}),/poisoned/)
    assert.equal(existsSync(join(refusedFixture,'launch-spec.json')),false)
    assert.equal(existsSync(join(refusedFixture,'desktop-job-acceptance.json')),false)
    assert.deepEqual(Object.fromEntries(preservedPaths.map(path=>[path,hash(path)])),preservedSha256)
    assert.equal(hash(ownSource),ownSourceSha256)
    const evidence=join(seeded.layoutRoot,'guarded-restart-failure-receipt.json')
    writeFileSync(evidence,JSON.stringify({schema:1,syntheticOnly:true,scenario,seeded,failed,refusedFixture,
      poisonedReuseRefusedBeforeLaunch:true,preservedSha256,failedStatePreserved:true,ownedPageRequests,
      interruptedAfterRealReadiness,acceptanceScript:{path:ownSource,sha256:ownSourceSha256},
      acceptanceScriptUnchanged:true,productionActivationVerified:false,releaseVerified:false},null,2),{flag:'wx'})
    scenarios.push({scenario,evidence})
    console.log(JSON.stringify({guardedRestartFailure:'PASS',scenario,evidence}))
  }finally{server.closeAllConnections();await new Promise(done=>server.close(done))}
}
assert.equal(hash(ownSource),ownSourceSha256)
console.log(JSON.stringify({guardedRestartFailures:'PASS',scenarios,productionActivationVerified:false}))
