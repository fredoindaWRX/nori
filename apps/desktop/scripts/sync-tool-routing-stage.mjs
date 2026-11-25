// Bring the existing staging slot up to the verified package; no new full build.
import {readFileSync,writeFileSync,existsSync,lstatSync,realpathSync,mkdirSync,copyFileSync,renameSync,unlinkSync} from 'node:fs'
import {join,resolve,dirname} from 'node:path'
import {verifyComponentManifest} from './component-integrity.mjs'
import {nativeDistributionPaths} from './native-distribution-inventory.mjs'
import {nativePayloadPlan} from './native-payload-plan.mjs'

const root=resolve(import.meta.dirname,'../../..'),release=join(root,'apps/desktop/release')
const candidate='image-runtime-20261018-r2'
const stage=join(release,`native-suite-${candidate}/NoriSuite`)
const suite=join(release,`native-desktop-${candidate}/win-unpacked/resources/NoriSuite`)
const receiptPath=join(stage,'native-payload-receipt.json')
const backup=join(root,'verification/tool-routing-stage-rollback')
const progress={onFile:({verifiedFiles})=>{if(verifiedFiles%10000===0)console.log('Verified',verifiedFiles)}}
for(const path of [root,release,dirname(stage),stage,suite,dirname(backup)]){
  if(lstatSync(path).isSymbolicLink()||realpathSync(path).toLowerCase()!==path.toLowerCase())throw Error('Linked path refused')
}
if(existsSync(backup))throw Error('Existing stage rollback preserved')
const originalBytes=readFileSync(receiptPath),old=JSON.parse(originalBytes)
const packaged=JSON.parse(readFileSync(join(release,`native-desktop-${candidate}/native-desktop-receipt.json`)))
if(old.copyVerified!==true||packaged.candidate!==candidate||packaged.packagedPayloadMatches!==true)throw Error('Invalid receipts')
const plan=nativePayloadPlan(root),names=plan.files.map(f=>f.path)
verifyComponentManifest(root,packaged.nativeManifest,names,progress)
console.log('Current source matches refreshed package manifest')
verifyComponentManifest(stage,old.manifest,nativeDistributionPaths(stage),progress)
const oldMap=new Map(old.manifest.files.map(f=>[f.path,f]))
const newMap=new Map(packaged.nativeManifest.files.map(f=>[f.path,f]))
if([...oldMap.keys()].some(path=>!newMap.has(path)))throw Error('Removal requires separate review')
const changes=packaged.nativeManifest.files.filter(f=>oldMap.get(f.path)?.sha256!==f.sha256)
if(changes.some(f=>!f.path.startsWith('apps/desktop/bridge/')&&!f.path.startsWith('integrations/image-generation/runtime/ComfyUI_windows_portable/ComfyUI/models/')))throw Error('Unexpected staging change')
const bytes=changes.reduce((n,f)=>n+f.bytes,0)
if(bytes>11*1024**3)throw Error('Staging delta exceeds bounded budget')
console.log(JSON.stringify({changed:changes.map(f=>f.path),copyBytes:bytes}))
mkdirSync(backup)
writeFileSync(join(backup,'receipt-before.json'),originalBytes,{flag:'wx'})
for(const f of changes){
  if(!oldMap.has(f.path)){if(existsSync(join(stage,f.path)))throw Error('Unexpected occupied target');continue}
  const dest=join(backup,f.path);mkdirSync(dirname(dest),{recursive:true});copyFileSync(join(stage,f.path),dest,1)
  verifyComponentManifest(backup,{...old.manifest,files:[oldMap.get(f.path)]},[f.path])
}
const touched=[]
try{
  for(const f of changes){
    const target=join(stage,f.path),temp=target+'.routing-stage.tmp'
    if(existsSync(temp))throw Error('Temporary path exists; preserved')
    const parent=dirname(target)
    if(realpathSync(parent).toLowerCase()!==parent.toLowerCase())throw Error('Redirected target parent')
    copyFileSync(join(suite,f.path),temp,1)
    verifyComponentManifest(stage,{...packaged.nativeManifest,files:[{...f,path:f.path+'.routing-stage.tmp'}]},[f.path+'.routing-stage.tmp'])
    renameSync(temp,target);touched.push(f.path)
  }
  verifyComponentManifest(stage,packaged.nativeManifest,nativeDistributionPaths(stage),progress)
  const next={...plan,manifest:packaged.nativeManifest,copied:plan.files.length,hardlinked:old.hardlinked,copiedModelFiles:old.copiedModelFiles??0,copyVerified:true,startupVerified:false}
  writeFileSync(receiptPath+'.routing-stage.tmp',JSON.stringify(next,null,2)+'\n',{flag:'wx'})
  renameSync(receiptPath+'.routing-stage.tmp',receiptPath)
  writeFileSync(join(backup,'completed.json'),JSON.stringify({stageMatches:true,sourceMatches:true,installed:false}),{flag:'wx'})
  console.log('Existing stage synchronized and verified; no new full suite created.')
}catch(error){
  for(const path of touched){
    const target=join(stage,path)
    if(oldMap.has(path)){copyFileSync(join(backup,path),target+'.restore.tmp',1);renameSync(target+'.restore.tmp',target)}
    else unlinkSync(target)
  }
  writeFileSync(receiptPath,originalBytes)
  throw error
}
