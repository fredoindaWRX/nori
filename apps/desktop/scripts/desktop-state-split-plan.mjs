import {privateStatePlan} from './private-state-plan.mjs'
import {createRequire} from 'node:module'
const {nativeStateLayout}=createRequire(import.meta.url)('../desktop/native-state-layout.cjs')

// Durable Chromium/Electron session data, not disposable cache. Unknown entries
// stay private rather than being dropped or exposed to the browser sandbox.
const browserEntries=new Set(['Local Storage','Session Storage','Network','Shared Dictionary',
  'blob_storage','IndexedDB','Service Worker','Storage','File System','databases',
  'Local State','Preferences','Cookies','Cookies-journal','DIPS','DIPS-journal',
  'declarative_performance_observer.db','declarative_performance_observer.db-journal'])
export function desktopStateSplitPlan(root,source,{inspectExistingDestination=false}={}){
  if(typeof inspectExistingDestination!=='boolean')throw Error('Explicit boolean inspection mode required')
  const full=privateStatePlan(root,source,{component:'desktop',inspectExistingDestination})
  const layout=nativeStateLayout(root)
  const browserPath=path=>browserEntries.has(path.split('/')[0])
  const part=(destination,browser)=>{
    const files=full.files.filter(file=>browserPath(file.path)===browser)
    return {destination,files,directories:full.directories.filter(path=>browserPath(path)===browser),
      bytes:files.reduce((sum,file)=>sum+file.bytes,0)}
  }
  return {schema:1,source:full.source,full,private:part(layout.desktop,false),browser:part(layout.browser,true),
    sameWindowsAccountRequired:true,browserDataSensitive:true,sourcePreserved:true,
    requiresQuiescence:true,activationAuthorized:false}
}
