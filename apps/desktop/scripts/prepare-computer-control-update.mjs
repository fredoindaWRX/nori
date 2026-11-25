import {readFileSync,existsSync,mkdirSync,copyFileSync,writeFileSync,realpathSync} from 'node:fs'
import {join,dirname,resolve,sep} from 'node:path'
import {createHash} from 'node:crypto'
import {execFileSync} from 'node:child_process'
import {createRequire} from 'node:module'
const {extractFile,listPackage,statFile}=createRequire(import.meta.url)('@electron/asar')
const root=resolve(import.meta.dirname,'../../..'),app=join(root,'apps/desktop')
const installed='C:/Program Files/Nori',shell=join(root,'verification/routing-closure-shell-refresh/win-unpacked')
const rollbackName=process.argv[2]||'computer-control-update-rollback'
if(!/^computer-control-[a-z0-9-]+-rollback$/.test(rollbackName))throw Error('Invalid bounded rollback name.')
const rollback=join(root,'verification',rollbackName)
const bridgeFiles=['artcraft-mcp-tools.mjs','neuralese-artcraft-plan.mjs','video-intent.mjs','local-video.mjs','nori-v2-query.mjs','computer-agent.mjs',
  'computer-host-client.mjs','computer-control-session.mjs','windows-computer-executor.mjs','windows-computer-control.ps1',
  'generated-video-file.mjs','neuralese-video-intent.mjs','video-duration.mjs','local-video-assembly.mjs','local-video-assembly.py',
  'artcraft-tools.mjs','image-intent.mjs','rea-tools.mjs']
// Reviewed reference data, not an executable skill. Keep its existing runtime
// pin and size; never expand this into a recursive skills directory copy.
const referenceDataFiles=[{path:'skills/nori-rea/skill.json',bytes:1425,
  sha256:'40cd7ee4dc0710cba25cc024626bcb1d1ba32765f04871fec99383504bfbd179'}]
const expected=new Set(['desktop/main.cjs','desktop/workspace-preload.cjs','desktop/computer-host.cjs','bridge/server.mjs',...bridgeFiles.map(name=>'bridge/'+name)])
const hash=bytes=>createHash('sha256').update(bytes).digest('hex')
const before=join(installed,'resources/app.asar'),after=join(shell,'resources/app.asar')
for(const path of expected)if(!extractFile(after,path).equals(readFileSync(join(app,path))))throw Error('Packaged update/source mismatch: '+path)
const names=archive=>listPackage(archive).filter(name=>!statFile(archive,name.slice(1)).files).map(name=>name.slice(1).replaceAll('\\','/'))
const oldNames=names(before),newNames=names(after),changed=[]
for(const name of new Set([...oldNames,...newNames])){
  const nativePath=name.split('/').join(sep)
  const old=oldNames.includes(name)?extractFile(before,nativePath):null,next=newNames.includes(name)?extractFile(after,nativePath):null
  if(old&&next&&old.equals(next))continue
  if(!expected.has(name)&&!name.startsWith('dist/'))throw Error('Unexpected archive update: '+name)
  changed.push(name)
}
const census=execFileSync(join(process.env.SystemRoot||'C:/Windows','System32/WindowsPowerShell/v1.0/powershell.exe'),
  ['-NoProfile','-NonInteractive','-Command',"@(Get-Process -Name Nori -ErrorAction SilentlyContinue).Count"],{encoding:'utf8',windowsHide:true}).trim()
if(census!=='0')throw Error('Quit Nori before preparing the installed update.')
if(existsSync(rollback))throw Error('A previous computer-control rollback already exists; preserve it.')
if(realpathSync(installed).toLowerCase()!==resolve(installed).toLowerCase())throw Error('Linked installation refused.')
const updates=[...['Nori.exe','resources/app.asar'].map(path=>({source:join(shell,path),relative:path})),
  ...bridgeFiles.map(name=>({source:join(app,'bridge',name),relative:'resources/NoriSuite/apps/desktop/bridge/'+name})),
  ...referenceDataFiles.map(file=>({source:join(root,file.path),relative:'resources/NoriSuite/'+file.path,
    expectedSha256:file.sha256,expectedBytes:file.bytes}))].map(item=>{
  const bytes=readFileSync(item.source),sha256=hash(bytes)
  if(item.expectedSha256&&(sha256!==item.expectedSha256||bytes.length!==item.expectedBytes))
    throw Error('Pinned reference data mismatch: '+item.relative)
  return {...item,bytes:bytes.length,sha256}
})
mkdirSync(rollback)
for(const item of updates){
  const target=join(installed,item.relative)
  if(existsSync(target)){
    item.beforeSha256=hash(readFileSync(target))
    const backup=join(rollback,item.relative);mkdirSync(dirname(backup),{recursive:true});copyFileSync(target,backup)
    if(hash(readFileSync(backup))!==item.beforeSha256)throw Error('Rollback copy mismatch.')
  }else item.beforeSha256=null
}
const receipt={schema:'nori.computer-control-update.v1',installedRoot:installed,updates,changedArchiveFiles:changed,
  installed:false,uiVerified:false,modelsCopied:0}
writeFileSync(join(rollback,'prepared.json'),JSON.stringify(receipt,null,2)+'\n',{flag:'wx'})
console.log(JSON.stringify({prepared:true,rollback,files:updates.length,updateBytes:updates.reduce((sum,file)=>sum+file.bytes,0),modelsCopied:0}))

