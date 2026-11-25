import {lstatSync,realpathSync,readdirSync,openSync,writeSync,fsyncSync,closeSync,linkSync,unlinkSync,fstatSync} from 'node:fs'
import {join,resolve,isAbsolute} from 'node:path'
import {randomUUID} from 'node:crypto'
import {spawnSync} from 'node:child_process'
import {createRequire} from 'node:module'
const require=createRequire(import.meta.url)
const {consolidatedStateSelection}=require('../desktop/consolidated-state-selection.cjs')
const {installedStatePolicy}=require('../desktop/installed-state-policy.cjs')
const {acquireStateOwner}=require('../desktop/state-owner.cjs')
const normalize=value=>process.platform==='win32'?value.toLowerCase():value

function knownLegacyProfiles(){
  const powershell=join(process.env.SystemRoot,'System32/WindowsPowerShell/v1.0/powershell.exe')
  const result=spawnSync(powershell,['-NoProfile','-Command',
    '[Environment]::GetFolderPath([Environment+SpecialFolder]::LocalApplicationData) | ConvertTo-Json -Compress'],
    {shell:false,windowsHide:true,encoding:'utf8',timeout:10000,maxBuffer:8192})
  if(result.error||result.status!==0)throw Error('Windows owner profile discovery failed; no activation')
  const base=JSON.parse(result.stdout.trim())
  if(typeof base!=='string'||!isAbsolute(base))throw Error('Windows owner profile discovery invalid; no activation')
  return ['Nori','Cortana','NoriV2'].map(name=>join(base,name))
}
function absent(path){
  try{lstatSync(path);return false}catch(error){if(error.code==='ENOENT')return true;throw error}
}
function plainDirectory(path){
  if(!lstatSync(path).isDirectory()||lstatSync(path).isSymbolicLink()||normalize(realpathSync(path))!==normalize(path))
    throw Error('Linked or non-directory activation path; no activation')
}

// Fresh-install publication only, not a migration shortcut. Installer integration
// must independently establish the original Windows owner and code-root ACLs.
// No CLI or automatic invocation; existing AppData/legacy profiles are preserved.
export function publishFreshInstalledLayout(applicationRoot,{freshInstall}={},
  {legacyProfiles=knownLegacyProfiles}={}){
  if(process.platform!=='win32'||freshInstall!==true)throw Error('Explicit fresh Windows install required; no activation')
  if(typeof applicationRoot!=='string'||!isAbsolute(applicationRoot))throw Error('Absolute application root required')
  const app=resolve(applicationRoot),suite=join(app,'resources/NoriSuite'),marker=join(app,'nori-install-layout.json')
  plainDirectory(app);plainDirectory(suite)
  const executable=join(app,'Nori.exe'),info=lstatSync(executable)
  if(!info.isFile()||info.isSymbolicLink()||info.size===0||normalize(realpathSync(executable))!==normalize(executable))
    throw Error('Packaged entry missing or linked; no activation')
  if(!absent(marker))throw Error('Existing install policy preserved')
  const profiles=legacyProfiles()
  if(!Array.isArray(profiles)||profiles.some(path=>typeof path!=='string'||!isAbsolute(path)))throw Error('Invalid legacy profile inventory')
  const refuseLegacy=()=>{if(profiles.some(path=>!absent(path)))throw Error('Existing owner profile requires verified migration; no fresh activation')}
  refuseLegacy()
  const scriptsRoot=join(app,'maintenance/scripts')
  const owners=[]
  let temporary,handle,published=false
  const layout=consolidatedStateSelection(suite,'consolidated-v1',{scriptsRoot})
  const assertFresh=()=>{
    for(const owner of owners)owner.assertHeld()
    refuseLegacy()
    // Empty new components only. A copied memory/profile cannot be silently
    // relabeled as a fresh installation, even if its permissions are correct.
    for(const path of [layout.core,layout.desktop,layout.browser])
      if(readdirSync(path).some(name=>name!=='.nori-state-owner.json'))throw Error('Nonempty prepared state requires migration; no fresh activation')
    if(readdirSync(layout.privateRoot).sort().join(',')!=='core,desktop')throw Error('Unexpected private components; no fresh activation')
    if(readdirSync(join(suite,'state')).sort().join(',')!=='browser,private')throw Error('Unexpected state components; no fresh activation')
    consolidatedStateSelection(suite,'consolidated-v1',{scriptsRoot})
  }
  try{
    for(const path of [layout.core,layout.desktop,layout.browser])owners.push(acquireStateOwner(path,{purpose:'migration'}))
    assertFresh()
    temporary=join(app,`.nori-install-layout-${randomUUID()}.tmp`)
    const bytes=Buffer.from(JSON.stringify({schema:'nori.installed-state-policy.v1',stateLayout:'consolidated-v1',suiteRelativePath:'resources/NoriSuite'})+'\n')
    handle=openSync(temporary,'wx',0o600)
    if(writeSync(handle,bytes)!==bytes.length)throw Error('Incomplete policy write; no activation')
    fsyncSync(handle)
    assertFresh()
    // Same-directory hardlink is atomic and refuses a racing destination.
    // Never rename over an existing policy or erase failure output.
    linkSync(temporary,marker);published=true
    assertFresh()
    const accepted=installedStatePolicy({executable,suiteRoot:suite})
    if(accepted?.mode!=='consolidated-v1')throw Error('Published policy failed validation; retained for review')
    return {policyPublished:true,preparedAclVerified:true,freshEmptyStateVerified:true,
      knownLegacyProfilesAbsent:true,cooperativeOwnershipHeld:true,migrationPerformed:false,
      originalInstallerOwnerVerified:false,codeRootPermissionsVerified:false,
      installedSuiteVerified:false,releaseVerified:false}
  }finally{
    let failure,stagedIdentity
    if(handle!==undefined){
      try{stagedIdentity=fstatSync(handle)}catch(error){failure??=error}
      try{closeSync(handle)}catch(error){failure??=error}
    }
    // Only remove our staging name after successful publication. Incomplete
    // activation output is retained; no state or policy deletion is authorized.
    if(published&&temporary)try{
      const current=lstatSync(temporary)
      if(!stagedIdentity||!current.isFile()||current.isSymbolicLink()||current.ino!==stagedIdentity.ino||current.dev!==stagedIdentity.dev)
        throw Error('Staging identity changed; foreign path preserved')
      unlinkSync(temporary)
    }catch(error){failure??=error}
    for(const owner of owners.reverse())try{owner.release()}catch(error){failure??=error}
    if(failure)throw failure
  }
}
