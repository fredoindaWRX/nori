import {existsSync,lstatSync,mkdirSync,readdirSync,realpathSync,writeFileSync,readFileSync} from 'node:fs'
import {dirname,isAbsolute,join,relative,resolve} from 'node:path'
import {pathToFileURL} from 'node:url'
import {verifiedCopy} from './verified-copy.mjs'
import {buildComponentManifest,verifyComponentManifest} from './component-integrity.mjs'
import {nativePayloadPlan} from './native-payload-plan.mjs'
import {inspectSingleAppPolicy} from './single-app-package-policy.mjs'

// Capture verified individual files into a fresh build root. This records a
// capture interval, not an atomic Git revision or permission to release.
export function captureBuildSnapshot(sourceRoot,targetRoot,paths){
  const source=realpathSync(sourceRoot),target=resolve(targetRoot)
  if(existsSync(target))throw Error('Build snapshot requires a fresh directory')
  if(!Array.isArray(paths)||!paths.length||paths.length>100000||new Set(paths).size!==paths.length)
    throw Error('Invalid build snapshot file list')
  const normalize=value=>process.platform==='win32'?value.toLowerCase():value
  const delta=relative(source,target).replaceAll('\\','/')
  if(!delta.startsWith('apps/desktop/release/')||delta.includes('../'))throw Error('Build snapshot must stay inside desktop release output')
  let ancestor=dirname(target)
  while(!existsSync(ancestor))ancestor=dirname(ancestor)
  if(normalize(realpathSync(ancestor))!==normalize(ancestor))throw Error('Linked snapshot output refused')
  for(const name of paths){
    if(typeof name!=='string'||!name||isAbsolute(name)||name.includes('\\')||name.split('/').some(p=>!p||p==='.'||p==='..'))
      throw Error('Unsafe build snapshot input')
    const path=resolve(source,name),info=lstatSync(path)
    if(!info.isFile()||info.isSymbolicLink()||normalize(realpathSync(path))!==normalize(path))throw Error('Linked or non-file snapshot input refused')
  }
  const started=new Date().toISOString()
  mkdirSync(target,{recursive:true})
  for(const name of paths)verifiedCopy(join(source,name),join(target,name))
  const manifest=buildComponentManifest(target,paths)
  verifyComponentManifest(target,manifest,paths)
  const receipt={schema:'nori.native-build-snapshot.v1',sourceRoot:source,captureStarted:started,
    captureCompleted:new Date().toISOString(),captureMode:'per-file-verified-copy',atomicRevision:false,
    manifest,copyVerified:true,startupVerified:false,releaseVerified:false}
  writeFileSync(join(target,'build-snapshot-receipt.json'),JSON.stringify(receipt,null,2)+'\n',{flag:'wx'})
  return receipt
}

export function nativeBuildSnapshotPaths(sourceRoot,{portableCatalog}={}){
  const root=realpathSync(sourceRoot),policy=inspectSingleAppPolicy(root)
  const files=new Set(nativePayloadPlan(root,{portableCatalog}).files.map(file=>file.path))
  for(const file of policy.files)files.add(file.path)
  const excluded=new Set(['.git','__pycache__','.cache','state','secrets','logs','tests'])
  const walk=name=>{
    const path=join(root,name),info=lstatSync(path)
    if(info.isSymbolicLink()||realpathSync(path).toLowerCase()!==resolve(path).toLowerCase())throw Error('Linked snapshot dependency refused')
    if(info.isDirectory()){
      for(const entry of readdirSync(path).sort())if(!excluded.has(entry)&&entry!=='.env'&&!entry.endsWith('.pyc'))walk(`${name}/${entry}`)
    }else if(info.isFile())files.add(name)
    else throw Error('Unsupported build snapshot input')
    if(files.size>100000)throw Error('Build snapshot inventory exceeds limit')
  }
  for(const name of ['dist','desktop','bridge','public','scripts','node_modules'])walk(`apps/desktop/${name}`)
  for(const name of ['package.json','electron-builder.native.yml'])walk(`apps/desktop/${name}`)
  walk('runtime/electron/v44.4.5')
  return [...files].sort()
}

export function assertSameSnapshotPaths(recorded,reconstructed){
  if(!Array.isArray(recorded)||!Array.isArray(reconstructed))throw Error('Snapshot closure comparison requires path lists')
  const left=[...recorded].sort(),right=[...reconstructed].sort()
  if(left.length!==right.length||left.some((name,index)=>name!==right[index])){
    const missing=right.filter(name=>!new Set(left).has(name)).slice(0,8)
    const extra=left.filter(name=>!new Set(right).has(name)).slice(0,8)
    throw Error(`Captured build closure differs from its own source: missing ${missing.join(',')||'none'}; extra ${extra.join(',')||'none'}`)
  }
  return true
}

// Import the copied planner from the copied root. This detects a source change
// that added or removed a required path after the initial inventory was made.
export async function verifyCapturedBuildSnapshot(targetRoot,{portableCatalog}={}){
  const target=realpathSync(targetRoot)
  const receipt=JSON.parse(readFileSync(join(target,'build-snapshot-receipt.json'),'utf8'))
  if(receipt.schema!=='nori.native-build-snapshot.v1'||receipt.copyVerified!==true)
    throw Error('Invalid captured build receipt')
  verifyComponentManifest(target,receipt.manifest,receipt.manifest.files.map(file=>file.path))
  const moduleUrl=pathToFileURL(join(target,'apps/desktop/scripts/native-build-snapshot.mjs')).href+`?closure=${Date.now()}`
  const captured=await import(moduleUrl)
  let reconstructed
  try{reconstructed=captured.nativeBuildSnapshotPaths(target,{portableCatalog})}
  catch(error){throw Error(`Captured build cannot reconstruct its own closure: ${error.message}`)}
  assertSameSnapshotPaths(receipt.manifest.files.map(file=>file.path),reconstructed)
  return {copyVerified:true,closureReconstructed:true,files:reconstructed.length,releaseVerified:false}
}
