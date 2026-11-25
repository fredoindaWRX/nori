// Bounded in-place code refresh. No installer launch, pointer change or model copy.
import {readFileSync,writeFileSync,existsSync,lstatSync,realpathSync,mkdirSync,copyFileSync,renameSync,unlinkSync} from 'node:fs'
import {join,dirname,resolve} from 'node:path'
import {createHash} from 'node:crypto'
import {execFileSync} from 'node:child_process'
import {createRequire} from 'node:module'
import {verifyComponentManifest,buildComponentManifest} from './component-integrity.mjs'
import {desktopArtifactPaths} from './desktop-artifacts.mjs'
import {nativeDistributionPaths} from './native-distribution-inventory.mjs'

const root=resolve(import.meta.dirname,'../../..'), app=join(root,'apps/desktop')
const candidate='image-runtime-20261018-r2'
const packageRoot=join(app,'release',`native-desktop-${candidate}`)
const desktop=join(packageRoot,'win-unpacked'), suite=join(desktop,'resources/NoriSuite')
const shell=join(root,'verification/tool-routing-shell-refresh/win-unpacked')
const receiptPath=join(packageRoot,'native-desktop-receipt.json')
const rollback=join(root,'verification/tool-routing-refresh-rollback')
const additions=['generated-video-file.mjs','local-video.mjs','neuralese-video-intent.mjs','video-intent.mjs'].map(f=>'apps/desktop/bridge/'+f)
const replacements=['artcraft-tools.mjs','local-chat.mjs','nori-v2-query.mjs'].map(f=>'apps/desktop/bridge/'+f)
const require=createRequire(import.meta.url),{extractFile}=require('@electron/asar')
const hash=bytes=>createHash('sha256').update(bytes).digest('hex')
const apply=process.argv.slice(2).join(' ')==='--apply'
function replaceFile(source,target){
  const temporary=target+'.routing-copy.tmp'
  if(existsSync(temporary))throw Error('Existing refresh temporary file preserved: '+temporary)
  copyFileSync(source,temporary,1)
  if(hash(readFileSync(source))!==hash(readFileSync(temporary)))throw Error('Refresh copy verification failed')
  renameSync(temporary,target)
}
if(process.argv.length>2&&!apply)throw Error('Only --apply is accepted; omit for verification only')
function physical(path){if(lstatSync(path).isSymbolicLink()||realpathSync(path).toLowerCase()!==resolve(path).toLowerCase())throw Error('Linked path refused: '+path)}
function stopped(){
  const ps=join(process.env.SystemRoot||'C:/Windows','System32/WindowsPowerShell/v1.0/powershell.exe')
  const result=execFileSync(ps,['-NoProfile','-NonInteractive','-Command',"$ErrorActionPreference='Stop'; @(Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -like 'C:\\Nori\\apps\\desktop\\release\\*' }).Count"],{encoding:'utf8',windowsHide:true}).trim()
  if(result!=='0')throw Error('Release processes are running or census is ambiguous; refresh refused')
}
for(const p of [root,app,dirname(packageRoot),packageRoot,desktop,suite,shell,dirname(rollback)])physical(p)
stopped()
if(existsSync(rollback))throw Error('Prior rollback exists; preserve and review before another update')
const originalBytes=readFileSync(receiptPath),old=JSON.parse(originalBytes)
if(old.candidate!==candidate||old.packagedPayloadMatches!==true)throw Error('Unexpected package receipt')
const progress={onFile:({verifiedFiles})=>{if(verifiedFiles%10000===0)console.log('Verified files:',verifiedFiles)}}
verifyComponentManifest(desktop,old.desktopManifest,desktopArtifactPaths(desktop),progress)
verifyComponentManifest(suite,old.nativeManifest,nativeDistributionPaths(suite),progress)
const oldNames=new Set(old.nativeManifest.files.map(f=>f.path))
if(additions.some(p=>oldNames.has(p)||existsSync(join(suite,p)))||replacements.some(p=>!oldNames.has(p)))throw Error('Unexpected native change set')
const nativeChanges=[...replacements,...additions].map(path=>{
  const source=join(root,path);physical(source)
  const bytes=readFileSync(source)
  if(bytes.length>1024*1024)throw Error('Code refresh unexpectedly large')
  if(!extractFile(join(shell,'resources/app.asar'),path.slice('apps/desktop/'.length)).equals(bytes))throw Error('Shell/source mismatch: '+path)
  return {path,bytes:bytes.length,sha256:hash(bytes)}
})
const oldDesktop=new Map(old.desktopManifest.files.map(f=>[f.path,f]))
const shellManifest=buildComponentManifest(shell,desktopArtifactPaths(shell))
const desktopChanges=[]
for(const f of shellManifest.files){
  const before=oldDesktop.get(f.path)
  if(!before)throw Error('Unexpected new shell path: '+f.path)
  if(before.sha256!==f.sha256||before.bytes!==f.bytes)desktopChanges.push(f)
}
if(desktopChanges.some(f=>!['Nori.exe','resources/app.asar'].includes(f.path)))throw Error('Unexpected shell change outside executable/archive')
const missing=old.desktopManifest.files.filter(f=>!shellManifest.files.some(s=>s.path===f.path))
if(missing.some(f=>!(f.path==='nori-components.json'||f.path.startsWith('backup-tools/')||f.path.startsWith('maintenance/'))))throw Error('Shell unexpectedly omits runtime files')
const nextNative={...old.nativeManifest,release_qualified:false,files:[...old.nativeManifest.files.filter(f=>!replacements.includes(f.path)),...nativeChanges].sort((a,b)=>a.path.localeCompare(b.path))}
const nextDesktop={...old.desktopManifest,release_qualified:false,files:old.desktopManifest.files.map(f=>desktopChanges.find(n=>n.path===f.path)||f)}
const next={...old,nativeManifest:nextNative,desktopManifest:nextDesktop,totalBytes:[...nextNative.files,...nextDesktop.files].reduce((n,f)=>n+f.bytes,0),installedSuiteVerified:false,releaseVerified:false}
console.log(JSON.stringify({apply,candidate,desktopChanges:desktopChanges.map(f=>f.path),nativeChanges:nativeChanges.map(f=>f.path),modelCopies:0}))
if(apply){
  stopped();mkdirSync(rollback)
  const entries=[...desktopChanges.map(f=>({source:join(shell,f.path),target:join(desktop,f.path),backup:join(rollback,'desktop',f.path)})),...nativeChanges.map(f=>({source:join(root,f.path),target:join(suite,f.path),backup:replacements.includes(f.path)?join(rollback,'native',f.path):null}))]
  for(const e of entries)if(e.backup){mkdirSync(dirname(e.backup),{recursive:true});copyFileSync(e.target,e.backup);if(hash(readFileSync(e.target))!==hash(readFileSync(e.backup)))throw Error('Rollback verification failed')}
  writeFileSync(join(rollback,'receipt-before.json'),originalBytes,{flag:'wx'})
  writeFileSync(join(rollback,'transaction.json'),JSON.stringify({candidate,entries},null,2),{flag:'wx'})
  try{
    stopped()
    for(const e of entries){physical(dirname(e.target));replaceFile(e.source,e.target)}
    verifyComponentManifest(desktop,nextDesktop,desktopArtifactPaths(desktop),progress)
    verifyComponentManifest(suite,nextNative,nativeDistributionPaths(suite),progress)
    writeFileSync(receiptPath+'.routing.tmp',JSON.stringify(next,null,2)+'\n',{flag:'wx'})
    renameSync(receiptPath+'.routing.tmp',receiptPath)
    writeFileSync(join(rollback,'completed.json'),JSON.stringify({integrityVerified:true,liveVerified:false,installed:false}),{flag:'wx'})
    console.log('Package code refreshed and integrity verified; installation and live acceptance remain pending.')
  }catch(error){
    for(const e of entries){if(e.backup)replaceFile(e.backup,e.target);else if(existsSync(e.target))unlinkSync(e.target)}
    writeFileSync(receiptPath,originalBytes)
    if(existsSync(receiptPath+'.routing.tmp'))unlinkSync(receiptPath+'.routing.tmp')
    throw error
  }
}
