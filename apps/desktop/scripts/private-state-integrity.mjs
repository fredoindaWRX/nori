import {lstatSync,readdirSync,realpathSync} from 'node:fs'
import {join,relative,isAbsolute,sep,resolve,dirname} from 'node:path'
import {buildComponentManifest,verifyComponentManifest} from './component-integrity.mjs'
import {verifyPrivateStatePlan} from './private-state-plan.mjs'
import {spawnSync} from 'node:child_process'
import {fileURLToPath} from 'node:url'

// Keep manifests private: paths and digests are migration evidence, not logs.
export function privateStateSnapshot(root,plan) {
  verifyPrivateStatePlan(root,plan)
  const paths=plan.files.map(file=>file.path)
  const manifest=paths.length?buildComponentManifest(plan.source,paths):null
  verifyPrivateStatePlan(root,plan)
  return {schema:1,manifest,directories:[...plan.directories],fileCount:paths.length}
}

// Metadata alone cannot detect a same-length rewrite with a restored timestamp.
// Recheck the original content before accepting a migration copy. This still
// does not prove that writers are stopped or authorize switching live state.
export function verifyPrivateStateSource(root,plan,snapshot) {
  verifyPrivateStatePlan(root,plan,{inspectExistingDestination:true})
  if(!snapshot||snapshot.schema!==1||snapshot.fileCount!==plan.files.length||
    JSON.stringify(snapshot.directories)!==JSON.stringify(plan.directories))
    throw Error('Private-state source snapshot differs from plan')
  if(plan.files.length)verifyComponentManifest(plan.source,snapshot.manifest,plan.files.map(file=>file.path))
  else if(snapshot.manifest!==null)throw Error('Invalid empty private-state snapshot')
  verifyPrivateStatePlan(root,plan,{inspectExistingDestination:true})
  return {sourceContentMatches:true,sourceMetadataMatches:true,activationAuthorized:false,requiresQuiescence:true}
}

export function verifyPrivateStateMigration(root,plan,snapshot,options={}) {
  verifyPrivateStateSource(root,plan,snapshot)
  // Destination comes from the validated plan, not a separately supplied path.
  verifyPrivateStateCopy(plan.destination,snapshot,options)
  verifyPrivateStateSource(root,plan,snapshot)
  return {schema:1,component:plan.component??'desktop',sourceContentMatches:true,
    copyContentMatches:true,copyInventoryMatches:true,sourcePreserved:true,
    requiresQuiescence:true,requiresProtectedAcl:true,sameWindowsAccountRequired:true,
    activationAuthorized:false,sourceRemovalAuthorized:false,migrationApplied:false}
}

export function verifyWindowsPrivateStateMigration(root,plan,snapshot,options={}) {
  if(process.platform!=='win32')throw Error('Windows private-state permission verification is required')
  verifyPrivateStateMigration(root,plan,snapshot,options)
  const powershell=join(process.env.SystemRoot,'System32/WindowsPowerShell/v1.0/powershell.exe')
  const script=fileURLToPath(new URL('./verify-private-state-acl.ps1',import.meta.url))
  const result=spawnSync(powershell,['-NoProfile','-File',script,'-Root',join(realpathSync(root),'state/private')],
    {encoding:'utf8',timeout:30000,windowsHide:true,shell:false,maxBuffer:1024*1024})
  // Do not expose private filenames, contents or account identifiers in logs.
  if(result.error||result.status!==0)throw Error('Windows private-state permission verification failed')
  const evidence=verifyPrivateStateMigration(root,plan,snapshot,options)
  return {...evidence,protectedAclVerified:true,quiescenceVerified:false}
}

export function verifyPrivateStateCopy(destination,snapshot,{destinationOwner}={}) {
  if(!snapshot||snapshot.schema!==1||!Array.isArray(snapshot.directories)||
    !Number.isSafeInteger(snapshot.fileCount)||snapshot.fileCount<0)
    throw Error('Invalid private-state snapshot')
  if(typeof destination!=='string'||!isAbsolute(destination))throw Error('Absolute private-state copy root required')
  const requested=resolve(destination)
  const normalize=value=>process.platform==='win32'?value.toLowerCase():value
  // A regular leaf beneath a junction is still redirected outside the requested
  // main-folder layout. Inspect the full ancestry, including dangling links.
  for(let current=requested;;current=dirname(current)){
    const info=lstatSync(current)
    if(info.isSymbolicLink()||!info.isDirectory()||normalize(realpathSync(current))!==normalize(current))
      throw Error('Linked private-state copy ancestry refused')
    if(dirname(current)===current)break
  }
  const root=realpathSync(requested)
  if(destinationOwner){
    const held=destinationOwner.assertHeld()
    if(held.directory!==root||held.purpose!=='migration')throw Error('Migration destination ownership mismatch')
  }
  if(lstatSync(destination).isSymbolicLink()||!lstatSync(root).isDirectory())throw Error('Unsafe private-state copy root')
  const directories=[],files=[]
  function walk(path){
    const info=lstatSync(path),delta=relative(root,realpathSync(path))
    if(info.isSymbolicLink()||delta==='..'||delta.startsWith('..'+sep)||isAbsolute(delta))throw Error('Linked private-state copy refused')
    if(info.isDirectory()){
      if(delta)directories.push(delta.replaceAll('\\','/'))
      for(const name of readdirSync(path).sort()){
        if(path===root&&name==='.nori-state-owner.json'&&destinationOwner){destinationOwner.assertHeld();continue}
        walk(join(path,name))
      }
    }else if(info.isFile())files.push(delta.replaceAll('\\','/'))
    else throw Error('Unsupported private-state copy entry')
  }
  walk(root)
  if(JSON.stringify(directories.sort())!==JSON.stringify([...snapshot.directories].sort())||files.length!==snapshot.fileCount)
    throw Error('Private-state copy inventory differs')
  if(files.length)verifyComponentManifest(root,snapshot.manifest,files)
  else if(snapshot.manifest!==null)throw Error('Invalid empty private-state snapshot')
  destinationOwner?.assertHeld()
  return {contentMatches:true,inventoryMatches:true,sourceRemovalAuthorized:false,activationAuthorized:false}
}
