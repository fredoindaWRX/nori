import {existsSync,mkdirSync,copyFileSync,constants} from 'node:fs'
import {join} from 'node:path'
import {spawnSync} from 'node:child_process'
import {fileURLToPath} from 'node:url'
import {createRequire} from 'node:module'
import {desktopStateSplitPlan} from './desktop-state-split-plan.mjs'
import {privateStateSnapshot,verifyPrivateStateSource,verifyPrivateStateCopy} from './private-state-integrity.mjs'
const {acquireStateOwner}=createRequire(import.meta.url)('../desktop/state-owner.cjs')
const {nativeStateLayout}=createRequire(import.meta.url)('../desktop/native-state-layout.cjs')

export function desktopStatePartSnapshot(fullSnapshot,part){
  const required=new Set(part.files.map(file=>file.path))
  const files=fullSnapshot.manifest?.files.filter(file=>required.has(file.path)).map(file=>({...file}))??[]
  if(required.size!==part.files.length||files.length!==required.size)throw Error('Split state snapshot differs from captured source inventory')
  return {schema:1,directories:[...part.directories],fileCount:files.length,
    manifest:files.length?{...fullSnapshot.manifest,files}:null}
}

// Fresh destination staging only. Never activate, overwrite, delete sources or
// erase a partial failure. Browser data is initially owner-protected too.
export function stageDesktopStateLayout(noriRoot,source){
  if(process.platform!=='win32')throw Error('Split desktop staging requires Windows')
  const layout=nativeStateLayout(noriRoot),root=layout.root
  const sourceOwner=acquireStateOwner(source,{purpose:'migration'}),owners=[]
  const powershell=join(process.env.SystemRoot,'System32/WindowsPowerShell/v1.0/powershell.exe')
  function run(script,args){
    const result=spawnSync(powershell,['-NoProfile','-File',fileURLToPath(new URL(script,import.meta.url)),...args],
      {encoding:'utf8',timeout:30000,windowsHide:true,shell:false})
    if(result.error||result.status!==0)throw Error('Split desktop staging permission check failed; source and partial destination preserved')
  }
  try{
    const plan=desktopStateSplitPlan(root,source)
    if(existsSync(layout.browser))throw Error('Existing browser destination preserved')
    const fullSnapshot=privateStateSnapshot(root,plan.full)
    // Both copies must use the SAME hashes captured for source verification.
    // Independently re-hashing parts could accept a transient writer's data.
    const parts=[plan.private,plan.browser].map(part=>({...part,snapshot:desktopStatePartSnapshot(fullSnapshot,part)}))
    if(!existsSync(layout.privateRoot))run('./provision-private-state.ps1',['-Root',root,'-Apply'])
    run('./verify-private-state-acl.ps1',['-Root',layout.privateRoot])
    sourceOwner.assertHeld()
    mkdirSync(layout.desktop)
    owners.push(acquireStateOwner(layout.desktop,{purpose:'migration'}))
    run('./provision-private-state.ps1',['-Root',root,'-Apply','-StorageClass','browser'])
    owners.push(acquireStateOwner(layout.browser,{purpose:'migration'}))
    for(const [index,part] of parts.entries()){
      const owner=owners[index]
      for(const directory of part.directories){sourceOwner.assertHeld();owner.assertHeld();mkdirSync(join(part.destination,directory),{recursive:true})}
      for(const file of part.files){sourceOwner.assertHeld();owner.assertHeld();copyFileSync(join(plan.source,file.path),join(part.destination,file.path),constants.COPYFILE_EXCL)}
      verifyPrivateStateCopy(part.destination,part.snapshot,{destinationOwner:owner})
    }
    verifyPrivateStateSource(root,plan.full,fullSnapshot)
    run('./verify-private-state-acl.ps1',['-Root',layout.privateRoot])
    run('./verify-private-state-acl.ps1',['-Root',layout.browser])
    for(const [index,part] of parts.entries())verifyPrivateStateCopy(part.destination,part.snapshot,{destinationOwner:owners[index]})
    sourceOwner.assertHeld()
    return {schema:1,privateFiles:plan.private.files.length,browserFiles:plan.browser.files.length,
      totalBytes:plan.private.bytes+plan.browser.bytes,sourceContentMatches:true,copyInventoryMatches:true,
      privateAclVerified:true,browserInitialPrivateAclVerified:true,cooperativeOwnershipHeldThroughoutCopy:true,
      excludedCaches:plan.full.excludedCaches,separateComponents:plan.full.separateComponents,
      sameWindowsAccountRequired:true,sourcePreserved:true,activationAuthorized:false,
      browserRuntimeAclPolicyVerified:false,quiescenceVerified:false}
  }finally{
    // Try every exact release even if one fails; never steal a foreign lease.
    let releaseError
    for(const owner of [...owners].reverse().concat(sourceOwner))try{owner.release()}catch(error){releaseError??=error}
    if(releaseError)throw releaseError
  }
}
