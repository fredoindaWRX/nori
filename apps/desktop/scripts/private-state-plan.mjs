import {existsSync,lstatSync,readdirSync,realpathSync} from 'node:fs'
import {isAbsolute,join,relative,resolve,dirname,sep} from 'node:path'
import {createRequire} from 'node:module'
const {nativeStateLayout}=createRequire(import.meta.url)('../desktop/native-state-layout.cjs')

// Names only: never read/print credentials, cookies, memory, or location data.
const cacheFolders=new Set(['Cache','Code Cache','GPUCache','DawnGraphiteCache','DawnWebGPUCache',
  'GPUPersistentCache','GrShaderCache','ShaderCache','VideoDecodeStats'])
const outsideRelative=value=>value==='..'||value.startsWith('..'+sep)||isAbsolute(value)
export function privateStatePlan(noriRoot,oldRoot,{component='desktop',inspectExistingDestination=false}={}) {
  if(!['desktop','core'].includes(component))throw new Error('Unknown private-state component')
  const layout=nativeStateLayout(noriRoot),root=layout.root
  if(lstatSync(oldRoot).isSymbolicLink()) throw new Error('Linked legacy state refused')
  const source=realpathSync(oldRoot)
  if(!lstatSync(source).isDirectory()) throw new Error('Legacy state is not a directory')
  const destination=layout[component]
  const normalized=value=>process.platform==='win32'?value.toLowerCase():value
  const overlap=relative(source,destination)
  const reverseOverlap=relative(destination,source)
  if(!overlap || !outsideRelative(overlap) || !outsideRelative(reverseOverlap))
    throw new Error('Migration destination overlaps legacy state')
  if(existsSync(destination)) {
    if(!inspectExistingDestination)throw new Error('Existing migration destination preserved')
    if(lstatSync(destination).isSymbolicLink()||!lstatSync(destination).isDirectory()||
      normalized(realpathSync(destination))!==normalized(destination))
      throw new Error('Unsafe existing migration destination')
  }
  let ancestor=dirname(destination)
  while(!existsSync(ancestor)) ancestor=dirname(ancestor)
  const physical=realpathSync(ancestor),delta=relative(root,physical)
  if(outsideRelative(delta) || normalized(physical)!==normalized(ancestor)) throw new Error('Private state destination ancestor is linked or escapes Nori')
  const files=[],directories=[],excludedCaches=[],separateComponents=[]
  function walk(path) {
    const info=lstatSync(path),actual=realpathSync(path),inside=relative(source,actual)
    if(info.isSymbolicLink() || outsideRelative(inside)) throw new Error('Linked private-state entry refused')
    if(info.isDirectory()) {
      directories.push(relative(source,path).replaceAll('\\','/'))
      for(const name of readdirSync(path).sort()) walk(join(path,name))
    }
    else if(info.isFile()) files.push({path:relative(source,path).replaceAll('\\','/'),bytes:info.size,mtimeMs:info.mtimeMs})
    else throw new Error('Unsupported private-state entry')
  }
  for(const name of readdirSync(source).sort()) {
    const item=join(source,name)
    const itemInfo=lstatSync(item)
    if(itemInfo.isSymbolicLink()) throw new Error('Linked private-state entry refused')
    // Electron cache names are not evidence that Core data is disposable.
    // Core's unknown directories must survive migration, including names that
    // happen to match desktop caches or the desktop model store.
    if(name==='.nori-state-owner.json'&&!itemInfo.isFile())
      throw new Error('Invalid source ownership record; migration refused')
    if(name==='.nori-state-owner.json')
      separateComponents.push({path:name,reason:'Ephemeral source ownership stays with its owner; never transfer to copied state'})
    else if(component==='desktop' && itemInfo.isDirectory() && cacheFolders.has(name)) excludedCaches.push(name)
    else if(component==='desktop' && itemInfo.isDirectory() && name==='models') separateComponents.push({path:name,reason:'Model inventory requires separate verified consolidation; not discarded'})
    else walk(item)
  }
  return {schema:1,component,source,destination,files,directories,bytes:files.reduce((sum,file)=>sum+file.bytes,0),
    excludedCaches,separateComponents,requiresQuiescence:true,requiresProtectedAcl:true,
    sameWindowsAccountRequired:true,sourcePreserved:true,migrationApplied:false}
}

// This metadata check supplements (never replaces) quiescence and content
// hashes. Run before provisioning/copying, while the destination is absent.
export function verifyPrivateStatePlan(noriRoot,plan,{inspectExistingDestination=false}={}) {
  if(!plan||plan.schema!==1||typeof plan.source!=='string'||typeof plan.destination!=='string'||
    !Array.isArray(plan.files)||!Array.isArray(plan.directories)||plan.migrationApplied!==false)
    throw new Error('Invalid private-state migration plan')
  const current=privateStatePlan(noriRoot,plan.source,{component:plan.component??'desktop',inspectExistingDestination})
  for(const field of ['source','destination','files','directories','excludedCaches','separateComponents','bytes'])
    if(JSON.stringify(current[field])!==JSON.stringify(plan[field]))
      throw new Error('Private state changed after planning; re-plan before copying')
  return {metadataMatches:true,copyAuthorized:false,requiresQuiescence:true,requiresContentHashes:true}
}
