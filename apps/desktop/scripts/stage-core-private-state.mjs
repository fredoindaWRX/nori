import {existsSync,mkdirSync,copyFileSync,constants} from 'node:fs'
import {join} from 'node:path'
import {fileURLToPath} from 'node:url'
import {spawnSync} from 'node:child_process'
import {createRequire} from 'node:module'
import {privateStatePlan} from './private-state-plan.mjs'
import {privateStateSnapshot,verifyWindowsPrivateStateMigration} from './private-state-integrity.mjs'
const {acquireStateOwner}=createRequire(import.meta.url)('../desktop/state-owner.cjs')
const {nativeStateLayout}=createRequire(import.meta.url)('../desktop/native-state-layout.cjs')

// Staging only. Cooperative exclusion covers managed Core/desktop, not unmanaged
// processes. Never activate, remove source, or erase a failed destination.
export function stagePrivateState(noriRoot,source,{component}={}) {
  if(!['core','desktop'].includes(component))throw Error('Unknown private-state component')
  if(process.platform!=='win32')throw Error('Protected private-state staging requires Windows')
  const layout=nativeStateLayout(noriRoot),root=layout.root,privateRoot=layout.privateRoot
  const owner=acquireStateOwner(source,{purpose:'migration'})
  let destinationOwner
  const powershell=join(process.env.SystemRoot,'System32/WindowsPowerShell/v1.0/powershell.exe')
  function run(name,args){
    const result=spawnSync(powershell,['-NoProfile','-File',fileURLToPath(new URL(name,import.meta.url)),...args],
      {encoding:'utf8',timeout:30000,windowsHide:true,shell:false})
    if(result.error||result.status!==0)throw Error('Protected private-state staging permission check failed; existing data preserved')
  }
  try{
    const plan=privateStatePlan(root,source,{component})
    const snapshot=privateStateSnapshot(root,plan)
    if(!existsSync(privateRoot))run('./provision-private-state.ps1',['-Root',root,'-Apply'])
    run('./verify-private-state-acl.ps1',['-Root',privateRoot])
    owner.assertHeld()
    mkdirSync(plan.destination)
    destinationOwner=acquireStateOwner(plan.destination,{purpose:'migration'})
    for(const directory of plan.directories){owner.assertHeld();destinationOwner.assertHeld();mkdirSync(join(plan.destination,directory),{recursive:true})}
    for(const file of plan.files){
      owner.assertHeld()
      destinationOwner.assertHeld()
      copyFileSync(join(plan.source,file.path),join(plan.destination,file.path),constants.COPYFILE_EXCL)
    }
    const evidence=verifyWindowsPrivateStateMigration(root,plan,snapshot,{destinationOwner})
    owner.assertHeld()
    return {...evidence,component,files:plan.files.length,bytes:plan.bytes,
      excludedCaches:plan.excludedCaches,separateComponents:plan.separateComponents,
      cooperativeOwnershipHeldThroughoutCopy:true,destinationOwnershipHeldThroughoutCopy:true}
  }finally{try{destinationOwner?.release()}finally{owner.release()}}
}
export function stageCorePrivateState(noriRoot,source) {
  return stagePrivateState(noriRoot,source,{component:'core'})
}
export function stageDesktopPrivateState(noriRoot,source) {
  return stagePrivateState(noriRoot,source,{component:'desktop'})
}
