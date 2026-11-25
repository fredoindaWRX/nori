import {spawn,spawnSync} from 'node:child_process'
import {createRequire} from 'node:module'
import {mkdtempSync,mkdirSync,writeFileSync,lstatSync,realpathSync,readFileSync,existsSync} from 'node:fs'
import {join,resolve,relative,isAbsolute,basename,dirname} from 'node:path'
import {fileURLToPath} from 'node:url'
import {randomBytes,createHash} from 'node:crypto'
import {publishJobMembership} from './job-membership-publication.mjs'
import {createGuardedRestartRegistry} from './guarded-restart-state.mjs'
import {archiveGuardedReadiness,captureGuardedReadiness} from './archive-guarded-readiness.mjs'
const {acquireStateOwner,acquireStateGuardian}=createRequire(import.meta.url)('../desktop/state-owner.cjs')
const {desktopJobPaths}=createRequire(import.meta.url)('../desktop/desktop-job-contract.cjs')
const {consolidatedStateSelection}=createRequire(import.meta.url)('../desktop/consolidated-state-selection.cjs')
const {validateStorageFixtureUrl}=createRequire(import.meta.url)('../desktop/browser-storage-fixture.cjs')
const restartStates=createGuardedRestartRegistry()
const root=resolve(fileURLToPath(new URL('../../../',import.meta.url)))
const scripts=fileURLToPath(new URL('./',import.meta.url))
const powershell=process.platform==='win32'?join(process.env.SystemRoot,'System32/WindowsPowerShell/v1.0/powershell.exe'):null
const measuredFiles=[
  'apps/desktop/scripts/owned-job-fixture.mjs','apps/desktop/scripts/windows-owned-job.cs',
  'apps/desktop/scripts/windows-job-fixture.cs','apps/desktop/scripts/probe-windows-owned-job.ps1',
  'apps/desktop/desktop/state-owner.cjs','apps/desktop/tests/windows-owned-job.test.mjs',
  'apps/desktop/scripts/job-desktop-entry.mjs','apps/desktop/scripts/probe-desktop.mjs',
  'apps/desktop/desktop/main.cjs','apps/desktop/scripts/probe-desktop-owned-job.mjs',
  'apps/desktop/desktop/desktop-job-contract.cjs','apps/desktop/desktop/native-state-layout.cjs',
  'apps/desktop/desktop/consolidated-state-selection.cjs','apps/desktop/desktop/workspace-probe.cjs',
  'apps/desktop/desktop/native-core.cjs','apps/desktop/desktop/native-stack.cjs',
  'apps/desktop/desktop/native-service.cjs','apps/desktop/scripts/provision-private-state.ps1',
  'apps/desktop/scripts/verify-private-state-acl.ps1','apps/desktop/scripts/verify-browser-state-acl.ps1',
  'apps/desktop/scripts/browser-capability-sid.ps1',
  'apps/desktop/desktop/job-census.cjs',
  'apps/desktop/scripts/job-membership-publication.mjs',
  'apps/desktop/scripts/guarded-restart-state.mjs','apps/desktop/scripts/archive-guarded-readiness.mjs',
  'apps/desktop/scripts/probe-desktop-guarded-restarts.mjs','apps/desktop/desktop/browser-storage-fixture.cjs',
  'apps/desktop/desktop/desktop-state-selection.cjs',
  'apps/desktop/desktop/desktop-session-outcome.cjs',
]
const digest=path=>createHash('sha256').update(readFileSync(path)).digest('hex')
const measureSources=()=>Object.fromEntries(measuredFiles.map(path=>[path,digest(join(root,path))]))
export function desktopJobEnvironment(source,compileTemp){
  const environment={}
  for(const [name,value] of Object.entries(source)){
    // Windows variable lookup is case-insensitive, including duplicate keys
    // in a JS object. Remove every spelling before setting fixed probe flags.
    const key=name.toUpperCase()
    if(key.startsWith('NORI_')||key.startsWith('LETTA_')||
      ['NODE_OPTIONS','NODE_PATH','ELECTRON_DISABLE_SANDBOX','ELECTRON_RUN_AS_NODE',
        'PYTHONPATH','PYTHONHOME','PYTHONSTARTUP','TEMP','TMP'].includes(key))continue
    environment[name]=value
  }
  return {...environment,TEMP:compileTemp,TMP:compileTemp,ELECTRON_RUN_AS_NODE:'1'}
}
function sourceBaseline(fixture){
  const path=join(fixture,'guardian-source-baseline.json'),info=lstatSync(path)
  if(info.isSymbolicLink()||!info.isFile()||info.size>16384)throw Error('Invalid owned Job source baseline')
  const baseline=JSON.parse(readFileSync(path,'utf8'))
  const current=measureSources()
  if(baseline.schema!==1||JSON.stringify(baseline.sourceSha256)!==JSON.stringify(current)||
    baseline.fixtureExecutableSha256!==digest(join(fixture,'job-fixture.exe')))
    throw Error('Owned Job source or executable changed since compilation')
  return baseline
}
function fixturePath(path){
  if(!isAbsolute(path)||relative(join(root,'verification'),path)!==basename(path)||!/^\.native-job-guardian-[\w-]+$/.test(basename(path)))
    throw Error('Generated owned Job fixture under Nori required')
  for(let ancestor=path;;ancestor=dirname(ancestor)){
    if(lstatSync(ancestor).isSymbolicLink())throw Error('Linked Job fixture refused')
    if(dirname(ancestor)===ancestor)break
  }
  if(realpathSync(path)!==resolve(path)||!lstatSync(path).isDirectory())throw Error('Unlinked Job fixture directory required')
}
export function prepareOwnedJobFixture(){
  if(process.platform!=='win32')throw Error('Owned Job acceptance requires Windows')
  const fixture=mkdtempSync(join(root,'verification/.native-job-guardian-'))
  const sourceSha256=measureSources()
  mkdirSync(join(fixture,'compile-temp'))
  const compiled=spawnSync(powershell,['-NoProfile','-Command',
    "Add-Type -Path @((Join-Path $env:NORI_JOB_SCRIPTS 'windows-owned-job.cs'),(Join-Path $env:NORI_JOB_SCRIPTS 'windows-job-fixture.cs')) -OutputAssembly (Join-Path $env:NORI_JOB_FIXTURE 'job-fixture.exe') -OutputType ConsoleApplication"],
    {encoding:'utf8',windowsHide:true,shell:false,timeout:20000,env:{...process.env,
      NORI_JOB_SCRIPTS:scripts,NORI_JOB_FIXTURE:fixture,TEMP:join(fixture,'compile-temp'),TMP:join(fixture,'compile-temp')}})
  if(compiled.error||compiled.status!==0)throw Error('Owned Job fixture compilation failed: '+compiled.stderr)
  if(JSON.stringify(sourceSha256)!==JSON.stringify(measureSources()))throw Error('Owned Job source changed during compilation')
  writeFileSync(join(fixture,'guardian-source-baseline.json'),JSON.stringify({schema:1,sourceSha256,
    fixtureExecutableSha256:digest(join(fixture,'job-fixture.exe'))},null,2),{flag:'wx'})
  return fixture
}
function freshConsolidatedLayout(){
  const layoutRoot=mkdtempSync(join(root,'verification/.native-browser-migration-job-'))
  for(const storageClass of ['private','browser']){
    const provision=spawnSync(powershell,['-NoProfile','-File',join(scripts,'provision-private-state.ps1'),
      '-Root',layoutRoot,'-Apply','-StorageClass',storageClass],
      {encoding:'utf8',windowsHide:true,shell:false,timeout:30000})
    if(provision.error||provision.status!==0)throw Error('Fresh synthetic consolidated state provisioning refused; partial fixture preserved')
  }
  mkdirSync(join(layoutRoot,'state/private/desktop'));mkdirSync(join(layoutRoot,'state/private/core'))
  return consolidatedStateSelection(layoutRoot,'consolidated-v1')
}
export function prepareGuardedDesktopRestartState({browserFixtureUrl}={}){
  if(process.platform!=='win32')throw Error('Guarded desktop restart acceptance requires Windows')
  validateStorageFixtureUrl(browserFixtureUrl)
  const sourceSha256=measureSources(),layout=freshConsolidatedLayout(),sessionNonce=randomBytes(32).toString('hex')
  const markerSha256={}
  for(const directory of [layout.desktop,layout.browser,layout.core]){
    const path=join(directory,'.nori-job-fixture-marker.json')
    writeFileSync(path,JSON.stringify({schema:1,syntheticOnly:true,sessionNonce}),{flag:'wx'});markerSha256[path]=digest(path)
  }
  mkdirSync(join(layout.desktop,'settings'))
  const setting=join(layout.desktop,'settings/guarded-restart-fixture.txt')
  writeFileSync(setting,'synthetic Nori setting retained across guarded restarts',{flag:'wx'});markerSha256[setting]=digest(setting)
  if(JSON.stringify(sourceSha256)!==JSON.stringify(measureSources()))throw Error('Restart source changed during state preparation')
  // This registry is private to this module; no supplied path or receipt can
  // recreate a lost handle, adopt a live profile, or revive a failed cycle.
  return restartStates.issue({layoutRoot:layout.root,sessionNonce,markerSha256,browserFixtureUrl,sourceSha256})
}
// Original exact lease closures remain in the external owner. Only a successful
// graceful root-handle+Job accounting proof AND host exit release them. Fault,
// timeout, force, guardian crash and foreign records preserve state ownership.
export async function runOwnedJobFixture({fixture,mode='delayed',argv=[],fault='none',desktopLayout='isolated-v1',desktopRestartState,timeoutMs=10000,callbackTimeoutMs=5000,onReady}={}){
  fixturePath(fixture)
  if(!['delayed','argv','hang','desktop'].includes(mode)||!['none','assignment','query'].includes(fault)||
    !Array.isArray(argv)||argv.length>32||argv.some(value=>typeof value!=='string'||value.includes('\0')||value.length>4096)||
    (mode==='desktop'&&(argv.length||fault!=='none'))||
    !['isolated-v1','consolidated-v1'].includes(desktopLayout)||(mode!=='desktop'&&desktopLayout!=='isolated-v1')||
    (desktopRestartState!==undefined&&(mode!=='desktop'||desktopLayout!=='consolidated-v1'))||
    !Number.isInteger(timeoutMs)||timeoutMs<50||timeoutMs>(mode==='desktop'?120000:30000)||
    !Number.isInteger(callbackTimeoutMs)||callbackTimeoutMs<50||callbackTimeoutMs>120000||
    (onReady!==undefined&&typeof onReady!=='function'))throw Error('Invalid owned Job fixture contract')
  const baseline=sourceBaseline(fixture)
  const restart=desktopRestartState===undefined?null:restartStates.begin(desktopRestartState)
  let restartFinalized=false
  try{
  if(restart&&JSON.stringify(restart.data.sourceSha256)!==JSON.stringify(baseline.sourceSha256))
    throw Error('Guarded restart requires the original unchanged source revision')
  const nonce=randomBytes(32).toString('hex')
  let state,paths,guardedDirectories=[],owners=[],desktopSpec={},syntheticMarkerSha256={},priorReadinessArchive
  if(mode==='desktop'){
    if(desktopLayout==='consolidated-v1'){
      const layout=restart?consolidatedStateSelection(restart.data.layoutRoot,'consolidated-v1'):freshConsolidatedLayout()
      desktopSpec={desktopLayout,layoutFixture:basename(layout.root),...(restart?{
        browserCookieMode:restart.cycle===0?'seed':'check',browserFixtureUrl:restart.data.browserFixtureUrl}:{})}
    }else{
      state=mkdtempSync(join(root,'verification/.native-desktop-probe-job-'))
      mkdirSync(join(root,'verification',basename(state).replace('.native-desktop-probe-','.native-browser-session-')))
      mkdirSync(join(state,'core'))
      desktopSpec={desktopLayout,profileFixture:basename(state)}
    }
    paths=desktopJobPaths(root,{schema:1,nonce,mode,argv,fault,...desktopSpec})
    state=paths.desktop;guardedDirectories=[...paths.guardedDirectories]
    // Ordinary app records remain the app's own. These distinct guardians
    // keep migration excluded AFTER main/Core release, until exact Job drain.
    for(const directory of guardedDirectories)owners.push(acquireStateGuardian(directory))
    if(restart){
      syntheticMarkerSha256={...restart.data.markerSha256}
      for(const [path,hash] of Object.entries(syntheticMarkerSha256)){
        const info=lstatSync(path)
        if(!info.isFile()||info.isSymbolicLink()||digest(path)!==hash)throw Error('Guarded restart marker/settings changed; state preserved')
      }
      if(existsSync(join(state,'desktop-failure.json')))throw Error('Failed guarded desktop output preserved; no automatic recovery')
      if(restart.previousReadiness)priorReadinessArchive=archiveGuardedReadiness({source:join(state,'desktop-readiness.json'),
        fixture:restart.previousReadiness.fixture,sha256:restart.previousReadiness.sha256})
      else if(existsSync(join(state,'desktop-readiness.json')))throw Error('Foreign readiness on fresh restart state preserved')
    }else if(desktopLayout==='consolidated-v1')for(const directory of guardedDirectories){
      const marker=join(directory,'.nori-job-fixture-marker.json')
      writeFileSync(marker,JSON.stringify({schema:1,syntheticOnly:true,nonce}),{flag:'wx'})
      syntheticMarkerSha256[marker]=digest(marker)
    }
  }else{
    state=join(fixture,'browser-state');mkdirSync(state)
    owners=[acquireStateOwner(state,{purpose:'desktop'})]
  }
  writeFileSync(join(fixture,'launch-spec.json'),JSON.stringify({schema:1,nonce,mode,argv,fault,timeoutMs,
    ...desktopSpec}),{flag:'wx'})
  const ownerAssertion=Object.freeze({assertHeld:()=>owners.map(owner=>owner.assertHeld())})
  const callbackControl=new AbortController()
  const environment=mode==='desktop'?desktopJobEnvironment(process.env,join(fixture,'compile-temp')):
    {...process.env,TEMP:join(fixture,'compile-temp'),TMP:join(fixture,'compile-temp')}
  const child=spawn(powershell,['-NoProfile','-File',join(scripts,'probe-windows-owned-job.ps1'),'-Root',fixture],
    {cwd:root,windowsHide:true,shell:false,stdio:['pipe','pipe','pipe'],env:environment})
  child.stdin.on('error',()=>{})
  let buffer='',bytes=0,stderr='',protocolError,ready,result,membership,ownerReleased=false,ownerReleaseError=false,callback
  const rows=[]
  child.stderr.on('data',data=>{stderr=(stderr+data).slice(-2000)})
  child.stdout.on('data',data=>{
    bytes+=data.length
    if(bytes>16384){protocolError=Error('Owned Job protocol exceeded bound');child.stdin.end();return}
    buffer+=data.toString('utf8')
    while(buffer.includes('\n')){
      const line=buffer.slice(0,buffer.indexOf('\n')).trim();buffer=buffer.slice(buffer.indexOf('\n')+1)
      try{
        const row=JSON.parse(line)
        if(row.nonce!==nonce||!['owned-job-ready','owned-job-members','owned-job-drained','owned-job-failed'].includes(row.kind))throw Error('Owned Job identity mismatch')
        rows.push(row)
        if(row.kind==='owned-job-ready'){
          if(ready||result||!Number.isInteger(row.rootPid)||row.rootPid<1||row.creationTimeAssociation!==true||
            row.breakawayEnabled!==false||row.jobHandleInherited!==false)throw Error('Invalid owned Job readiness')
          ready=Object.freeze(row)
          let callbackTimer
          callback=Promise.race([
            Promise.resolve().then(()=>onReady?.({ready,child,state,owner:ownerAssertion,signal:callbackControl.signal,
              guardedDirectories:Object.freeze([...guardedDirectories]),getMembership:()=>membership})),
            new Promise((_,reject)=>{callbackTimer=setTimeout(()=>reject(Error('Owned Job readiness callback deadline')),callbackTimeoutMs)}),
          ]).catch(error=>{protocolError=error;callbackControl.abort();child.stdin.end()})
            .finally(()=>clearTimeout(callbackTimer))
        }else if(row.kind==='owned-job-members'){
          if(mode!=='desktop'||!ready||result||membership||row.rootPid!==ready.rootPid||!Array.isArray(row.processIds)||
            row.syntheticOnly!==true||row.processIds.length>512||row.processIds.some(id=>!Number.isInteger(id)||id<1)||
            new Set(row.processIds).size!==row.processIds.length||!row.processIds.includes(ready.rootPid))
            throw Error('Invalid exact Job membership record')
          membership=Object.freeze({...row,processIds:Object.freeze([...row.processIds])})
          // Publish the host-validated exact snapshot to the in-Job diagnostic
          // probe. Existing/foreign files refuse; no process ancestry adoption.
          publishJobMembership(fixture,membership)
        }else{
          if(result)throw Error('Duplicate owned Job terminal record')
          result=row
        }
      }catch(error){protocolError=error;child.stdin.end()}
    }
  })
  const killTimer=setTimeout(()=>{protocolError=Error('Owned guardian host deadline');child.kill()},timeoutMs+15000)
  const exit=await new Promise(done=>{
    child.once('error',error=>done({error:error.code}));child.once('exit',(code,signal)=>done({code,signal}))
  }).finally(()=>clearTimeout(killTimer))
  await callback
  callbackControl.abort()
  let sourcesUnchanged=false
  try{sourcesUnchanged=JSON.stringify(baseline.sourceSha256)===JSON.stringify(measureSources())&&
    baseline.fixtureExecutableSha256===digest(join(fixture,'job-fixture.exe'))}catch{}
  let desktopAcceptance,desktopAccepted=mode!=='desktop'
  if(mode==='desktop')try{
    const path=join(fixture,'desktop-job-acceptance.json'),info=lstatSync(path)
    if(!info.isFile()||info.isSymbolicLink()||info.size>65536)throw Error('Invalid desktop Job acceptance')
    desktopAcceptance=JSON.parse(readFileSync(path,'utf8'))
    desktopAccepted=desktopAcceptance.nonce===nonce&&desktopAcceptance.profile===state&&
      desktopAcceptance.rootPid===ready?.rootPid&&desktopAcceptance.ready===true&&
      desktopAcceptance.cleanup?.desktop_probe_cleanup==='PASS'&&desktopAcceptance.cleanup?.exit?.code===0&&
      desktopAcceptance.cleanup?.desktopOwnershipVerified===true&&
      desktopAcceptance.desktopLayout===desktopLayout&&desktopAcceptance.migrationDeniedAtReadiness===3&&
      desktopAcceptance.cleanup?.jobDrainDelegated===true&&
      desktopAcceptance.cleanup?.childCensus==='exact-job-snapshot-filtered-cim'&&membership&&
      desktopAcceptance.nativePids?.every(id=>Number.isInteger(id)&&membership.processIds.includes(id))&&
      desktopAcceptance.nativePids.length===4&&new Set(desktopAcceptance.nativePids).size===4&&
      (!restart||(desktopAcceptance.readiness?.renderer?.browserCookie?.mode===desktopSpec.browserCookieMode&&
        desktopAcceptance.readiness.renderer.browserCookie.syntheticCookieVerified===true&&
        desktopAcceptance.readiness.renderer.browserStorage?.localStorageVerified===true&&
        desktopAcceptance.readiness.renderer.browserStorage.indexedDbVerified===true&&
        desktopAcceptance.readiness.renderer.browserStorage.remoteNetworkUsed===false&&
        desktopAcceptance.readiness.renderer.browserStorage.loopbackFixtureUsed===true))&&
      desktopAcceptance.cleanup?.observedStartupChildren?.some(record=>record.name==='electron.exe'&&membership.processIds.includes(record.pid))&&
      guardedDirectories.every(directory=>!existsSync(join(directory,'.nori-state-owner.json')))
  }catch{}
  let consolidatedPermissionsVerified=false,syntheticMarkersPreserved=mode!=='desktop'||desktopLayout==='isolated-v1'
  if(mode==='desktop'&&desktopLayout==='consolidated-v1'&&desktopAccepted&&exit.code===0&&
    result?.kind==='owned-job-drained'&&result.rootHandleExited===true&&result.activeProcesses===0&&result.forced===false){
    try{
      consolidatedStateSelection(paths.layoutRoot,'consolidated-v1');consolidatedPermissionsVerified=true
      syntheticMarkersPreserved=Object.entries(syntheticMarkerSha256).every(([path,hash])=>{
        const info=lstatSync(path);return info.isFile()&&!info.isSymbolicLink()&&digest(path)===hash
      })
    }catch{}
  }
  // Include time spent in post-drain permission verification in the evidence.
  try{sourcesUnchanged=sourcesUnchanged&&JSON.stringify(baseline.sourceSha256)===JSON.stringify(measureSources())&&
    baseline.fixtureExecutableSha256===digest(join(fixture,'job-fixture.exe'))}catch{sourcesUnchanged=false}
  let capturedReadiness
  if(restart&&desktopAccepted&&consolidatedPermissionsVerified&&syntheticMarkersPreserved)try{
    capturedReadiness={fixture,sha256:captureGuardedReadiness(join(state,'desktop-readiness.json'),desktopAcceptance.readiness)}
  }catch{desktopAccepted=false}
  const graceful=desktopAccepted&&(mode!=='desktop'||desktopLayout==='isolated-v1'||consolidatedPermissionsVerified)&&
    syntheticMarkersPreserved&&sourcesUnchanged&&!protocolError&&buffer.trim()===''&&exit.code===0&&result?.kind==='owned-job-drained'&&ready&&
    result.rootPid===ready.rootPid&&result.rootHandleExited===true&&result.activeProcesses===0&&
    Number.isInteger(result.totalProcesses)&&result.totalProcesses>=1&&result.rootExitCode===0&&result.forced===false
  if(graceful){
    try{
      // Preflight every exact guardian, then each release rechecks its own
      // bytes. This is cooperative exclusion, not an atomic multi-file delete.
      owners.forEach(owner=>owner.assertHeld());owners.forEach(owner=>owner.release());ownerReleased=true
    }catch{ownerReleaseError=true}
  }
  const evidence={schema:1,syntheticOnly:true,fixture,mode,fault,ready,result,membership,exit,
    sourceSha256:baseline.sourceSha256,fixtureExecutableSha256:baseline.fixtureExecutableSha256,sourcesUnchanged,
    ownerReleased,ownerReleaseError,ownerRecordPreserved:mode==='desktop'
      ?guardedDirectories.some(directory=>existsSync(join(directory,'.nori-state-guardian.json')))
      :existsSync(join(state,'.nori-state-owner.json')),
    ...(mode==='desktop'?{profile:state,desktopLayout,layoutRoot:paths.layoutRoot,guardedDirectories,
      consolidatedPermissionsVerified,syntheticMarkerSha256,syntheticMarkersPreserved,desktopAccepted,desktopAcceptance}:{}) ,
    ...(restart?{guardedRestartCycle:restart.cycle,browserCookieMode:desktopSpec.browserCookieMode,
      originalSessionNonce:restart.data.sessionNonce,priorReadinessArchive,capturedReadiness}:{}),
    protocolAccepted:!protocolError,jobExitProven:result?.kind==='owned-job-drained'&&result.rootHandleExited===true&&result.activeProcesses===0,
    productionGuardianIntegrated:false,releaseVerified:false}
  writeFileSync(join(fixture,'job-guardian-receipt.json'),JSON.stringify(evidence,null,2),{flag:'wx'})
  if(restart){restart.finish(graceful&&ownerReleased,capturedReadiness);restartFinalized=true}
  if(protocolError)throw Error('Owned Job protocol refused: '+protocolError.message)
  return {...evidence,diagnostic:stderr}
  }finally{if(restart&&!restartFinalized)restart.finish(false)}
}
