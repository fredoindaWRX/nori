/** Explicit real source Electron workspace session. No install or capture. */
import {spawn,execFileSync} from 'node:child_process'
import {createServer} from 'node:net'
import {createServer as createHttpServer} from 'node:http'
import {randomBytes} from 'node:crypto'
import {mkdtempSync,mkdirSync,existsSync,readFileSync,lstatSync} from 'node:fs'
import {join,resolve} from 'node:path'
import {fileURLToPath} from 'node:url'
import {createInterface} from 'node:readline'
import {createRequire} from 'node:module'
const {acquireStateOwner}=createRequire(import.meta.url)('../desktop/state-owner.cjs')
const {readDesktopJobSpec}=createRequire(import.meta.url)('../desktop/desktop-job-contract.cjs')
const {jobCensus}=createRequire(import.meta.url)('../desktop/job-census.cjs')
const {readinessMs:readinessTimeoutMs}=createRequire(import.meta.url)('./probe-deadlines.cjs')
const root=resolve(fileURLToPath(new URL('../../../',import.meta.url)))
const packaged=process.argv.includes('--packaged')
const once=process.argv.includes('--once')
const modify=process.argv.includes('--modify')
const earth=process.argv.includes('--earth')
const monitor=process.argv.includes('--monitor')
const earlyQuit=process.argv.includes('--quit-during-startup')
const gptOss=process.argv.includes('--gpt-oss')
if(gptOss&&(!packaged||earlyQuit))throw Error('GPT-OSS probe requires a packaged session and cannot interrupt startup')
// Explicit owner-visible preview: fresh generated state, sensors still denied,
// no automatic normal-session lifetime limit. Stop/tray Quit remains available.
const demo=process.argv.includes('--demo')
if(demo&&(process.argv.length!==3||process.argv[2]!=='--demo'))
  throw Error('Visible source demo accepts only --demo and fresh state')
const browserCookieArgument=process.argv.find(value=>value.startsWith('--browser-cookie='))
const browserCookieMode=browserCookieArgument?.slice('--browser-cookie='.length)
if(browserCookieArgument&&(packaged||earlyQuit||!once||!['seed','check'].includes(browserCookieMode)))
  throw Error('Browser cookie acceptance requires an explicit source once-only seed/check mode')
if(earlyQuit&&(process.platform!=='win32'||packaged))throw Error('Early startup quit probe requires Windows source mode')
const probeArgs=['--workspace-probe',...(gptOss?['--nori-gpt-oss']:[]),...(demo?['--visible-demo']:[]),...(modify?['--manage-installation']:[]),...(earth?['--earth-check']:[]),...(monitor?['--monitor-check']:[]),
  ...(browserCookieArgument?[browserCookieArgument]:[])]
const candidateArgument=process.argv.find(value=>value.startsWith('--candidate='))
const profileArgument=process.argv.find(value=>value.startsWith('--profile-fixture='))
const layoutArgument=process.argv.find(value=>value.startsWith('--layout-fixture='))
const guardedJobArgument=process.argv.find(value=>value.startsWith('--guarded-job-fixture='))
const guardedJobFixture=guardedJobArgument?.slice('--guarded-job-fixture='.length)
let guardedJobSpec
if(guardedJobArgument){
  if(packaged||earlyQuit||!once||Boolean(profileArgument)===Boolean(layoutArgument))
    throw Error('Guarded Job requires exactly one explicit source once-only state selector')
  const {spec,paths}=readDesktopJobSpec(root,guardedJobFixture)
  guardedJobSpec=spec
  if(spec.browserCookieMode!==browserCookieMode||
    (browserCookieMode&&spec.browserFixtureUrl!==process.env.NORI_BROWSER_STATE_FIXTURE_URL))
    throw Error('Guarded browser continuity does not match the owned manifest')
  if(profileArgument?spec.desktopLayout!=='isolated-v1'||spec.profileFixture!==profileArgument.slice('--profile-fixture='.length):
    spec.desktopLayout!=='consolidated-v1'||spec.layoutFixture!==layoutArgument.slice('--layout-fixture='.length))
    throw Error('Guarded Job manifest does not own this exact synthetic state')
  if(paths.guardedDirectories.some(directory=>!existsSync(join(directory,'.nori-state-guardian.json'))))
    throw Error('An external synthetic state guardian is missing')
}
const layoutFixture=layoutArgument?.slice('--layout-fixture='.length)
if(layoutArgument&&(packaged||earlyQuit||!once||profileArgument||!/^\.native-browser-migration-[\w-]+$/.test(layoutFixture)))
  throw Error('Layout reuse requires an explicit source once-only consolidated fixture')
if(layoutArgument)probeArgs.push('--consolidated-layout-probe')
const profileFixture=profileArgument?.slice('--profile-fixture='.length)
if(profileArgument&&(packaged||earlyQuit||!once||!/^\.native-desktop-probe-[\w-]+$/.test(profileFixture)))
  throw Error('Profile reuse requires an explicit source once-only isolated fixture')
const candidate=candidateArgument?candidateArgument.slice('--candidate='.length):'current'
if(!/^[a-z0-9][a-z0-9-]{0,63}$/.test(candidate))throw Error('Unsafe desktop probe candidate name')
if(candidateArgument&&!packaged)throw Error('Candidate selection requires packaged mode')
const packagedRoot=join(root,`apps/desktop/release/native-desktop-${candidate}/win-unpacked`)
if(packaged&&!existsSync(join(packagedRoot,'Nori.exe')))throw Error('Packaged candidate executable is missing; no probe state created')
const suiteRoot=packaged?join(packagedRoot,'resources/NoriSuite'):root
const verification=join(suiteRoot,'verification')
mkdirSync(verification,{recursive:true})
const layoutRoot=layoutArgument?join(verification,layoutFixture):null
const directory=layoutRoot?join(layoutRoot,'state/private/desktop'):profileArgument?join(verification,profileFixture):mkdtempSync(join(verification,'.native-desktop-probe-'))
if(profileArgument||layoutArgument){
  // Reuse only a fixture prepared by an acceptance caller, never AppData.
  for(const name of ['desktop-readiness.json','desktop-failure.json','.nori-state-owner.json'])
    if(existsSync(join(directory,name)))throw Error('Reused profile contains stale acceptance output or ownership; preserved')
  const ownership=acquireStateOwner(directory,{purpose:guardedJobArgument?'desktop':'migration'});ownership.release()
}
const ownerKey=randomBytes(48).toString('base64url')
const owner=createHttpServer((request,response)=>{
  response.writeHead(request.url==='/owner' && request.headers.authorization===`Bearer ${ownerKey}`?200:403)
  response.end()
})
await new Promise(ready=>owner.listen(0,'127.0.0.1',ready))
const port=async()=>{
  const server=createServer()
  await new Promise((ready,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',ready)})
  const value=server.address().port
  await new Promise(done=>server.close(done))
  return value
}
const inherited=demo?Object.fromEntries(Object.entries(process.env).filter(([name])=>
  !/^(?:NORI_|LETTA_|NODE|PYTHON|ELECTRON_|NPM_|PIP_|CONDA_|UV_|CHROME|CHROMIUM)/i.test(name)&&
  !/SANDBOX/i.test(name)&&!/^(?:VIRTUAL_ENV|__COMPAT_LAYER)$/i.test(name))):process.env
const environment={...inherited,NORI_DESKTOP_PORT:String(await port()),NORI_BRIDGE_PORT:String(await port()),
  NORI_WORKSPACE_PROBE_STATE:directory,NORI_LEARNING_FILE:join(directory,'probe-memory.json'),
  NORI_WORKSPACE_PROBE_OWNER_URL:`http://127.0.0.1:${owner.address().port}/owner`,NORI_WORKSPACE_PROBE_OWNER_KEY:ownerKey,
  NORI_INFERENCE_RUNTIME:gptOss?'gpt-oss':'norllama',NORI_ALLOW_WRITES:'0',
  ...(layoutRoot?{NORI_WORKSPACE_PROBE_LAYOUT_ROOT:layoutRoot}:{})}
delete environment.ELECTRON_RUN_AS_NODE
if(packaged) for(const name of ['NORI_RUNTIME_PYTHON','NORI_PYTHON','NORI_TTS_PYTHON','NORI_TTS_MODEL','NORI_TTS_VOICES',
  'NORI_TTS_WORKER','NORI_ROOT','NORI_SUITE_ROOT','NORI_RUNTIME_URL','NORI_RUNTIME_API_KEY']) delete environment[name]
const child=spawn(packaged?join(packagedRoot,'Nori.exe'):join(root,'runtime/electron/v44.4.5/electron.exe'),
  packaged?probeArgs:[join(root,'apps/desktop'),...probeArgs],{
  // Keep the test window visible only for the owner-requested source demo.
  // Acceptance probes retain the hidden-window default.
  cwd:packaged?packagedRoot:root,env:environment,windowsHide:!demo,stdio:['pipe','pipe','pipe'],shell:false,
})
let diagnostic='',exitResult,stopping=false
const exited=new Promise(done=>{child.once('exit',(code,signal)=>{exitResult={code,signal};done(exitResult)});child.once('error',error=>{exitResult={error:error.code};done(exitResult)})})
child.stdout.on('data',bytes=>{diagnostic=(diagnostic+bytes).slice(-4000)})
child.stderr.on('data',bytes=>{diagnostic=(diagnostic+bytes).slice(-4000)})
child.stdin.on('error',()=>{})
const alive=pid=>{try{process.kill(pid,0);return true}catch{return false}}
const wait=ms=>new Promise(done=>setTimeout(done,ms))
let receipt
let desktopOwnershipVerified=false
let observedStartupChildren=[]
function checkDesktopOwnership(){
  const ownership=JSON.parse(readFileSync(join(directory,'.nori-state-owner.json'),'utf8'))
  if(ownership.purpose!=='desktop'||ownership.pid!==child.pid)throw Error('Desktop profile ownership mismatch')
  try{
    const unexpected=acquireStateOwner(directory,{purpose:'migration'})
    unexpected.release()
    throw Error('Active desktop profile incorrectly allowed migration ownership')
  }catch(error){if(error.code!=='EEXIST')throw error}
  desktopOwnershipVerified=true
  if(layoutRoot){
    const browserDirectory=join(layoutRoot,'state/browser')
    const browserOwner=JSON.parse(readFileSync(join(browserDirectory,'.nori-state-owner.json'),'utf8'))
    if(browserOwner.purpose!=='desktop'||browserOwner.pid!==child.pid)throw Error('Browser session ownership mismatch')
    try{const unexpected=acquireStateOwner(browserDirectory,{purpose:'migration'});unexpected.release();throw Error('Active browser permitted migration')}
    catch(error){if(error.code!=='EEXIST')throw error}
    if(receipt){
      const coreDirectory=join(layoutRoot,'state/private/core')
      const coreOwner=JSON.parse(readFileSync(join(coreDirectory,'.nori-state-owner.json'),'utf8'))
      // Core lease belongs to the Electron launcher that owns the Python child,
      // not the child PID reported by native Core readiness.
      if(coreOwner.purpose!=='core'||coreOwner.pid!==child.pid)throw Error('Consolidated Core ownership mismatch')
      try{const unexpected=acquireStateOwner(coreDirectory,{purpose:'migration'});unexpected.release();throw Error('Active Core permitted migration')}
      catch(error){if(error.code!=='EEXIST')throw error}
    }
  }
}
async function observeStartupChildren(){
  // Read-only inventory; only numeric PID ancestry is selected. No command
  // lines, environment, credentials, or unrelated process termination.
  const records=JSON.parse(execFileSync(join(process.env.SystemRoot,'System32/WindowsPowerShell/v1.0/powershell.exe'),
    ['-NoProfile','-Command','Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name | ConvertTo-Json -Compress'],
    {encoding:'utf8',windowsHide:true,timeout:10000}))
  if(guardedJobSpec){
    const path=join(root,'verification',guardedJobFixture,'owned-job-membership.json'),deadline=Date.now()+3000
    while(!existsSync(path)){
      if(Date.now()>deadline)throw Error('Exact owned Job membership was not published')
      await wait(10)
    }
    const info=lstatSync(path)
    if(!info.isFile()||info.isSymbolicLink()||info.size>65536)throw Error('Invalid bounded owned Job membership')
    return jobCensus(records,JSON.parse(readFileSync(path,'utf8')),
      {nonce:guardedJobSpec.nonce,rootPid:process.pid,electronPid:child.pid})
  }
  const family=new Set([child.pid]), descendants=[]
  for(let changed=true;changed;){
    changed=false
    for(const record of records)if(!family.has(record.ProcessId)&&family.has(record.ParentProcessId)){
      family.add(record.ProcessId);descendants.push({pid:record.ProcessId,name:record.Name});changed=true
    }
  }
  return descendants
}
async function stop(){
  if(stopping)return
  stopping=true
  owner.close();owner.closeAllConnections() // Exact owned GUI app detects owner departure.
  child.stdin.end()
  const timer=setTimeout(()=>child.kill(),35000)
  await exited;clearTimeout(timer)
  const ids=[...new Set([...(receipt?[receipt.runtime.corePid,receipt.runtime.runtimePid,receipt.runtime.workerPid]:[]),
    ...observedStartupChildren.map(record=>record.pid)])]
  const deadline=Date.now()+5000
  // In guarded mode historical numeric IDs are diagnostic only: they can be
  // reused for unrelated processes. The external ORIGINAL Job handle must
  // observe full physical drain before any state guardian can release.
  while(!guardedJobSpec&&ids.some(alive)&&Date.now()<deadline)await wait(50)
  let monitorClosed=true
  if(receipt?.projectMonitor?.endpoint){
    try{await fetch(receipt.projectMonitor.endpoint+'/project/',{signal:AbortSignal.timeout(2000)});monitorClosed=false}catch{}
  }
  const desktopOwnershipReleased=!existsSync(join(directory,'.nori-state-owner.json'))
  const browserOwnershipReleased=!layoutRoot||!existsSync(join(layoutRoot,'state/browser/.nori-state-owner.json'))
  const coreOwnershipReleased=!layoutRoot||!existsSync(join(layoutRoot,'state/private/core/.nori-state-owner.json'))
  const observedGone=ids.every(pid=>!alive(pid))
  console.log(JSON.stringify({desktop_probe_cleanup:guardedJobSpec||observedGone?'PASS':'FAIL',exit:exitResult,
    desktopOwnershipVerified,desktopOwnershipReleased,browserOwnershipReleased,coreOwnershipReleased,
    earlyQuit,observedStartupChildren,
    childCensus:guardedJobSpec?'exact-job-snapshot-filtered-cim':'pid-ancestry-diagnostic-only',
    jobDrainDelegated:Boolean(guardedJobSpec),
    monitorClosed,
    statePreserved:directory,...(guardedJobSpec?{diagnosticNumericProcessIdsStillPresent:ids.filter(alive)}:
      {ownedProcessesRemaining:ids.filter(alive)})}))
  process.exitCode=exitResult?.code===0 && (guardedJobSpec||observedGone) && monitorClosed &&
    browserOwnershipReleased && coreOwnershipReleased && (packaged || desktopOwnershipVerified && desktopOwnershipReleased)?0:1
}
process.once('SIGINT',()=>void stop())
process.once('SIGTERM',()=>void stop())
const watchdog=demo?undefined:setTimeout(()=>void stop(),300000)
try{
  const deadline=Date.now()+readinessTimeoutMs,path=join(directory,'desktop-readiness.json')
  while(!existsSync(path)){
    if(earlyQuit&&existsSync(join(directory,'.nori-state-owner.json'))){
      checkDesktopOwnership()
      observedStartupChildren=await observeStartupChildren()
      if(existsSync(path))throw Error('Startup quit probe reached readiness before interruption; not qualified')
      if(!observedStartupChildren.some(record=>record.name.toLowerCase()==='python.exe'))
        throw Error('No native startup child observed; interruption not qualified')
      console.log(JSON.stringify({desktop_probe:'STARTUP_INTERRUPTION',electronPid:child.pid,observedStartupChildren}))
      await stop()
      if(existsSync(path))throw Error('Desktop became ready after startup interruption')
      console.log(JSON.stringify({startupInterruptedBeforeReadiness:true,profile:directory}))
      break
    }
    const failure=join(directory,'desktop-failure.json')
    if(existsSync(failure))throw new Error(`Source desktop startup failed: ${readFileSync(failure,'utf8')}`)
    if(exitResult)throw new Error(`Owned Electron exited before readiness: ${JSON.stringify(exitResult)}; ${diagnostic}`)
    if(Date.now()>deadline)throw new Error(`Desktop readiness deadline; ${diagnostic}`)
    await wait(50)
  }
  if(!earlyQuit){
  receipt=JSON.parse(readFileSync(path,'utf8'))
  if(!packaged)checkDesktopOwnership()
  if(process.platform==='win32')observedStartupChildren=await observeStartupChildren()
  console.log(JSON.stringify({desktop_probe:'READY',electronPid:child.pid,receipt:path,summary:receipt}))
  if(once){await stop();await exited;}
  else {
  console.log('Type stop and Enter to close only this test session.')
  const input=createInterface({input:process.stdin})
  input.on('line',line=>{if(line.trim()==='stop')void stop()})
  input.on('close',()=>void stop())
  await exited
  input.close()
  if(!stopping)await stop()
  }
  }
}catch(error){console.error(error.message);await stop();process.exitCode=1}
finally{clearTimeout(watchdog)}
