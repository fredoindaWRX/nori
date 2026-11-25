// Fixed synthetic-only source desktop entry inside the owned Windows Job.
import {spawn} from 'node:child_process'
import {readFileSync,writeFileSync,lstatSync,realpathSync,existsSync} from 'node:fs'
import {resolve,join,basename,relative,dirname} from 'node:path'
import {fileURLToPath} from 'node:url'
import {createRequire} from 'node:module'
const {desktopJobPaths}=createRequire(import.meta.url)('../desktop/desktop-job-contract.cjs')
const {acquireStateOwner}=createRequire(import.meta.url)('../desktop/state-owner.cjs')
const root=resolve(fileURLToPath(new URL('../../../',import.meta.url)))
const fixture=process.argv[2]
if(typeof fixture!=='string'||relative(join(root,'verification'),fixture)!==basename(fixture)||
  !/^\.native-job-guardian-[\w-]+$/.test(basename(fixture)))throw Error('Generated desktop Job fixture required')
for(let path=fixture;;path=dirname(path)){
  if(lstatSync(path).isSymbolicLink())throw Error('Linked desktop Job fixture refused')
  if(path===dirname(path))break
}
const manifest=join(fixture,'launch-spec.json'),info=lstatSync(manifest)
if(!info.isFile()||info.isSymbolicLink()||info.size>65536)throw Error('Invalid desktop Job manifest')
const spec=JSON.parse(readFileSync(manifest,'utf8'))
const paths=desktopJobPaths(root,spec)
const profile=paths.desktop
if(realpathSync(profile)!==profile)throw Error('Unlinked desktop profile required')
let ready=false,cleanup,nativePids=[],readiness,migrationDeniedAtReadiness=0
const log=console.log.bind(console)
console.log=(...values)=>{
  if(values.length===1&&typeof values[0]==='string'&&values[0].startsWith('{'))try{
    const record=JSON.parse(values[0])
    if(record.desktop_probe==='READY'){
      readiness=record.summary
      ready=readiness.privateProfile===profile&&readiness.browserSession===paths.browser&&
        readiness.consolidatedStateSelected===(spec.desktopLayout==='consolidated-v1')&&
        (spec.desktopLayout!=='consolidated-v1'||readiness.selectedCoreState===paths.core)&&
        readiness.runtime?.runtime==='NorLlama'&&readiness.runtime?.backend==='norama-independent'&&
        readiness.runtime?.modelId==='llama3.2-3b-instruct'&&Object.keys(readiness.runtime?.ports??{}).length===12&&
        readiness.runtime?.sensorsEnabled===0&&readiness.runtime?.taskExecutionQualified===false&&
        readiness.sensorsDenied===true&&readiness.captureDenied===true&&readiness.writesEnabled===false
      nativePids=[record.electronPid,record.summary?.runtime?.corePid,record.summary?.runtime?.runtimePid,
        record.summary?.runtime?.workerPid]
      if(ready)for(const directory of paths.guardedDirectories){
        if(!existsSync(join(directory,'.nori-state-guardian.json')))throw Error('Readiness guardian disappeared')
        try{const invalid=acquireStateOwner(directory,{purpose:'migration'});invalid.release();throw Error('Readiness migration bypassed guard')}
        catch(error){if(error.code!=='EEXIST')throw error;migrationDeniedAtReadiness++}
      }
    }
    if(record.desktop_probe_cleanup)cleanup=record
  }catch{ready=false}
  log(...values)
}
process.argv=[process.execPath,fileURLToPath(new URL('./probe-desktop.mjs',import.meta.url)),
  '--once',spec.desktopLayout==='consolidated-v1'?`--layout-fixture=${spec.layoutFixture}`:
    `--profile-fixture=${spec.profileFixture}`,`--guarded-job-fixture=${basename(fixture)}`,
  ...(spec.browserCookieMode?[`--browser-cookie=${spec.browserCookieMode}`]:[])]
// desktopJobPaths validated the exact bounded loopback URL. Parent NORI_*
// values were removed; no caller environment can select a different origin.
if(spec.browserFixtureUrl)process.env.NORI_BROWSER_STATE_FIXTURE_URL=spec.browserFixtureUrl
try{
  await import('./probe-desktop.mjs')
  if(ready&&cleanup?.desktop_probe_cleanup==='PASS'&&cleanup.exit?.code===0){
    // A real test writer outlives app/entry teardown. The external guardians
    // must still exclude migration until this direct Job descendant exits.
    const helper=spawn(join(fixture,'job-fixture.exe'),[fixture,'child'],{windowsHide:true,shell:false,stdio:'ignore'})
    helper.on('error',()=>{process.exitCode=1})
    const end=Date.now()+3000
    while(!existsSync(join(fixture,'child-started.txt'))&&Date.now()<end)await new Promise(done=>setTimeout(done,10))
    if(!existsSync(join(fixture,'child-started.txt')))throw Error('Delayed owned teardown child never started')
    helper.unref()
  }
}finally{
  console.log=log
  writeFileSync(join(fixture,'desktop-job-acceptance.json'),JSON.stringify({schema:1,nonce:spec.nonce,
    rootPid:process.pid,profile,desktopLayout:spec.desktopLayout,migrationDeniedAtReadiness,
    ready,nativePids,readiness,cleanup},null,2),{flag:'wx'})
}
