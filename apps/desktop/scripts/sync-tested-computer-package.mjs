// Refresh the retained slot, using bounded code copies and transactional receipts.
import {readFileSync,writeFileSync,existsSync,lstatSync,realpathSync,mkdirSync,copyFileSync,renameSync,unlinkSync} from 'node:fs'
import {join,resolve,dirname} from 'node:path'
import {createHash} from 'node:crypto'
import {createRequire} from 'node:module'
import {execFileSync} from 'node:child_process'
import {nativePayloadPlan} from './native-payload-plan.mjs'
import {verifyComponentManifest,buildComponentManifest} from './component-integrity.mjs'
import {nativeDistributionPaths} from './native-distribution-inventory.mjs'
import {desktopArtifactPaths} from './desktop-artifacts.mjs'
import {inspectSingleAppPolicy,verifyPackagedAppIdentity} from './single-app-package-policy.mjs'

const root=resolve(import.meta.dirname,'../../..'),app=join(root,'apps/desktop'),release=join(app,'release')
const candidate='image-runtime-20261018-r2',packageRoot=join(release,`native-desktop-${candidate}`)
const desktop=join(packageRoot,'win-unpacked'),suite=join(desktop,'resources/NoriSuite')
const stage=join(release,`native-suite-${candidate}/NoriSuite`),shell=join(root,'verification/tool-routing-shell-refresh/win-unpacked')
const desktopReceipt=join(packageRoot,'native-desktop-receipt.json'),stageReceipt=join(stage,'native-payload-receipt.json')
const backupName=process.argv[2]||'computer-package-sync-rollback'
if(!/^computer-[a-z0-9-]+-rollback$/.test(backupName))throw Error('Invalid bounded sync rollback name.')
const backup=join(root,'verification',backupName)
const {extractFile}=createRequire(import.meta.url)('@electron/asar')
const hash=bytes=>createHash('sha256').update(bytes).digest('hex')
const changedNative=['artcraft-mcp-tools.mjs','nori-v2-query.mjs','video-intent.mjs','local-video.mjs','computer-agent.mjs',
  'computer-control-session.mjs','computer-host-client.mjs','windows-computer-control.ps1','windows-computer-executor.mjs'].map(name=>'apps/desktop/bridge/'+name)
const changedDesktop=['Nori.exe','resources/app.asar']
const progress={onFile:({verifiedFiles})=>{if(verifiedFiles%10000===0)console.log('Verified files:',verifiedFiles)}}
function physical(path){if(lstatSync(path).isSymbolicLink()||realpathSync(path).toLowerCase()!==resolve(path).toLowerCase())throw Error('Linked path refused: '+path)}
function stopped(){
  const count=execFileSync(join(process.env.SystemRoot||'C:/Windows','System32/WindowsPowerShell/v1.0/powershell.exe'),
    ['-NoProfile','-NonInteractive','-Command',"@(Get-CimInstance Win32_Process | Where-Object {$_.ExecutablePath -like 'C:\\Nori\\apps\\desktop\\release\\*'}).Count"],{encoding:'utf8',windowsHide:true}).trim()
  if(count!=='0')throw Error('A retained release is currently running; update refused.')
}
function replace(source,target){
  physical(dirname(target))
  const temporary=target+'.computer-sync.tmp'
  if(existsSync(temporary))throw Error('Existing temporary file preserved.')
  copyFileSync(source,temporary,1)
  if(hash(readFileSync(source))!==hash(readFileSync(temporary)))throw Error('Code copy mismatch.')
  renameSync(temporary,target)
}
for(const path of [root,release,packageRoot,desktop,suite,stage,shell,dirname(backup)])physical(path)
stopped()
if(existsSync(backup))throw Error('Existing sync rollback preserved.')
const oldPackageBytes=readFileSync(desktopReceipt),oldStageBytes=readFileSync(stageReceipt)
const oldPackage=JSON.parse(oldPackageBytes),oldStage=JSON.parse(oldStageBytes)
if(oldPackage.candidate!==candidate||oldPackage.packagedPayloadMatches!==true||oldStage.copyVerified!==true)throw Error('Unexpected retained receipt.')
const plan=nativePayloadPlan(root),policy=inspectSingleAppPolicy(root)
const replacements=changedNative.map(path=>{
  const source=join(root,path);physical(source)
  const bytes=readFileSync(source)
  if(bytes.length>1024*1024||!extractFile(join(shell,'resources/app.asar'),path.slice('apps/desktop/'.length)).equals(bytes))throw Error('Shell/source mismatch: '+path)
  return {path,bytes:bytes.length,sha256:hash(bytes)}
})
const nextNative={...oldPackage.nativeManifest,files:[...oldPackage.nativeManifest.files.filter(file=>!changedNative.includes(file.path)),...replacements].sort((a,b)=>a.path.localeCompare(b.path))}
if(JSON.stringify(plan.files.map(file=>file.path).sort())!==JSON.stringify(nextNative.files.map(file=>file.path).sort()))throw Error('Unexpected source inventory change.')
console.log('Verifying source and both existing payloads before code replacement.')
verifyComponentManifest(root,nextNative,plan.files.map(file=>file.path),progress)
verifyComponentManifest(desktop,oldPackage.desktopManifest,desktopArtifactPaths(desktop),progress)
verifyComponentManifest(suite,oldPackage.nativeManifest,nativeDistributionPaths(suite),progress)
verifyComponentManifest(stage,oldStage.manifest,nativeDistributionPaths(stage),progress)
const shellManifest=buildComponentManifest(shell,desktopArtifactPaths(shell))
for(const file of shellManifest.files){
  const old=oldPackage.desktopManifest.files.find(item=>item.path===file.path)
  if(!old||(!changedDesktop.includes(file.path)&&(old.sha256!==file.sha256||old.bytes!==file.bytes)))throw Error('Unexpected desktop support-file change.')
}
const nextDesktop={...oldPackage.desktopManifest,files:oldPackage.desktopManifest.files.map(file=>changedDesktop.includes(file.path)?shellManifest.files.find(item=>item.path===file.path):file)}
if(nextDesktop.files.some(file=>!file))throw Error('Incomplete updated desktop.')
verifyPackagedAppIdentity(shell,policy)
const entries=[...changedDesktop.map(path=>({source:join(shell,path),target:join(desktop,path),backup:join(backup,'desktop',path)})),
  ...replacements.flatMap(file=>[suite,stage].map((targetRoot,index)=>({source:join(root,file.path),target:join(targetRoot,file.path),
    backup:existsSync(join(targetRoot,file.path))?join(backup,index===0?'native':'stage',file.path):null})))]
mkdirSync(backup)
writeFileSync(join(backup,'desktop-receipt-before.json'),oldPackageBytes,{flag:'wx'})
writeFileSync(join(backup,'stage-receipt-before.json'),oldStageBytes,{flag:'wx'})
for(const entry of entries)if(entry.backup){mkdirSync(dirname(entry.backup),{recursive:true});copyFileSync(entry.target,entry.backup,1);if(hash(readFileSync(entry.target))!==hash(readFileSync(entry.backup)))throw Error('Rollback copy mismatch.')}
const touched=[]
try{
  stopped()
  for(const entry of entries){replace(entry.source,entry.target);touched.push(entry)}
  verifyComponentManifest(desktop,nextDesktop,desktopArtifactPaths(desktop),progress)
  verifyComponentManifest(suite,nextNative,nativeDistributionPaths(suite),progress)
  verifyComponentManifest(stage,nextNative,nativeDistributionPaths(stage),progress)
  const nextPackage={...oldPackage,desktopManifest:nextDesktop,nativeManifest:nextNative,singleAppPolicy:policy,
    totalBytes:[...nextDesktop.files,...nextNative.files].reduce((sum,file)=>sum+file.bytes,0),installedSuiteVerified:false,releaseVerified:false}
  const nextStage={...plan,manifest:nextNative,copied:plan.files.length,hardlinked:oldStage.hardlinked,
    copiedModelFiles:oldStage.copiedModelFiles??0,copyVerified:true,startupVerified:false}
  writeFileSync(desktopReceipt+'.computer-sync.tmp',JSON.stringify(nextPackage,null,2)+'\n',{flag:'wx'})
  writeFileSync(stageReceipt+'.computer-sync.tmp',JSON.stringify(nextStage,null,2)+'\n',{flag:'wx'})
  renameSync(desktopReceipt+'.computer-sync.tmp',desktopReceipt)
  renameSync(stageReceipt+'.computer-sync.tmp',stageReceipt)
  writeFileSync(join(backup,'completed.json'),JSON.stringify({sourceMatches:true,packageMatches:true,stageMatches:true,modelCopies:0,installed:false,releaseQualified:false})+'\n',{flag:'wx'})
  console.log('Retained package and stage synchronized. Complete installer rebuild and normal desktop acceptance remain pending.')
}catch(error){
  for(const entry of touched.reverse())if(entry.backup)replace(entry.backup,entry.target);else if(existsSync(entry.target))unlinkSync(entry.target)
  writeFileSync(desktopReceipt,oldPackageBytes);writeFileSync(stageReceipt,oldStageBytes)
  throw error
}
