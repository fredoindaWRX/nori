import {createHash} from 'node:crypto'
import {build,Platform,Arch} from 'electron-builder'
import {existsSync,lstatSync,realpathSync,statSync,readFileSync,writeFileSync,
  mkdirSync,copyFileSync,renameSync,unlinkSync,createReadStream} from 'node:fs'
import {dirname,join,relative,resolve} from 'node:path'
import {createRequire} from 'node:module'
import {nativeBuilderConfig} from './package-native-desktop.mjs'
import {nativePayloadPlan} from './native-payload-plan.mjs'
import {verifyComponentManifest,buildComponentManifest} from './component-integrity.mjs'
import {desktopArtifactPaths} from './desktop-artifacts.mjs'
import {nativeDistributionPaths} from './native-distribution-inventory.mjs'
import {inspectSingleAppPolicy,recheckSingleAppPolicy,verifyPackagedAppIdentity} from './single-app-package-policy.mjs'
import {journalWorkflow} from './project-workflow-journal.mjs'

const require=createRequire(import.meta.url)
const {extractFile}=require('@electron/asar')
const root=resolve(import.meta.dirname,'../../..'),app=join(root,'apps/desktop')
async function sha256(path){
  const hash=createHash('sha256')
  for await(const chunk of createReadStream(path))hash.update(chunk)
  return hash.digest('hex')
}
const reportProgress=label=>({onFile:({verifiedFiles})=>{
  if(verifiedFiles%10000===0)console.log(`${label}: ${verifiedFiles} files verified`)
}})
const candidate=process.argv[2]
if(typeof candidate!=='string'||!/^[a-z0-9][a-z0-9-]{0,63}$/.test(candidate))
  throw Error('Expected one safe existing candidate ID')

await journalWorkflow('package','refresh-desktop-candidate','apps/desktop/scripts/refresh-verified-desktop-candidate.mjs',async()=>{
  const release=join(app,'release')
  const candidateRoot=join(release,`native-desktop-${candidate}`)
  const desktop=join(candidateRoot,'win-unpacked')
  const suite=join(desktop,'resources','NoriSuite')
  const outerPath=join(candidateRoot,'native-desktop-receipt.json')
  const innerPath=join(suite,'native-payload-receipt.json')
  const pointerPath=join(release,'current-desktop.txt')
  const output=join(root,'verification',`${candidate}-shell-refresh-r2`)
  const rollback=join(root,'verification',`${candidate}-refresh-r2-attempt2-rollback`)
  const expectedNewFiles=[
    'engine/gpt-oss-runtime/build/bin/cublas64_13.dll',
    'engine/gpt-oss-runtime/build/bin/cublasLt64_13.dll',
    'engine/gpt-oss-runtime/build/bin/NVIDIA-CUDA-EULA.txt',
  ]
  const changedNativeSources=[
    'apps/desktop/bridge/local-chat.mjs',
    'apps/desktop/desktop/gpt-oss-service.cjs',
  ]
  const allowedNativeChanges=new Set([...expectedNewFiles,...changedNativeSources])
  const normalize=value=>process.platform==='win32'?value.toLowerCase():value
  for(const path of [release,candidateRoot,desktop,suite]){
    if(!existsSync(path)||lstatSync(path).isSymbolicLink()||normalize(realpathSync(path))!==normalize(path))
      throw Error('Candidate path is missing, linked, or not the requested physical directory')
  }
  if(existsSync(rollback))throw Error('Rollback directory already exists; existing artifacts preserved')
  if(existsSync(output)&&(lstatSync(output).isSymbolicLink()||normalize(realpathSync(output))!==normalize(output)))
    throw Error('Existing shell output is linked or not its requested physical directory')
  const selected=readFileSync(pointerPath,'utf8').trim()
  if(selected===candidate)throw Error('Candidate is selected by the normal launcher; refresh refused')
  const original=JSON.parse(readFileSync(outerPath,'utf8'))
  const inner=JSON.parse(readFileSync(innerPath,'utf8'))
  if(original.schema!==1||original.candidate!==candidate||original.currentSelected!==false||
     original.installedSuiteVerified!==false||!original.packagedPayloadMatches||
     JSON.stringify(original.nativeManifest)!==JSON.stringify(inner.manifest)||inner.copyVerified!==true)
    throw Error('Candidate receipts do not match the approved unselected-candidate precondition')

  // Establish the exact pre-refresh desktop and native bytes before changing them.
  const oldDesktopPaths=desktopArtifactPaths(desktop)
  verifyComponentManifest(desktop,original.desktopManifest,oldDesktopPaths,reportProgress('Existing desktop'))
  const oldNativePaths=nativeDistributionPaths(suite)
  const oldNativeNames=new Set(original.nativeManifest.files.map(file=>file.path))
  const newFileSet=new Set(expectedNewFiles)
  if(oldNativeNames.size!==original.nativeManifest.files.length||
     oldNativePaths.length<oldNativeNames.size||oldNativePaths.length>oldNativeNames.size+newFileSet.size||
     oldNativePaths.some(path=>!oldNativeNames.has(path)&&!newFileSet.has(path))||
     expectedNewFiles.some(path=>oldNativeNames.has(path)))
    throw Error('Candidate native inventory has unexplained files; no refresh applied')
  verifyComponentManifest(suite,original.nativeManifest,undefined,reportProgress('Existing native suite'))

  const plan=nativePayloadPlan(root)
  const planByPath=new Map(plan.files.map(file=>[file.path,file]))
  const oldNativeByPath=new Map(original.nativeManifest.files.map(file=>[file.path,file]))
  const expectedNames=new Set([...oldNativeNames,...expectedNewFiles])
  if(planByPath.size!==expectedNames.size||[...planByPath.keys()].some(path=>!expectedNames.has(path)))
    throw Error('Current native payload source has changes outside the approved refresh scope')
  const unchangedSourceManifest={...original.nativeManifest,
    files:original.nativeManifest.files.filter(file=>!allowedNativeChanges.has(file.path))}
  verifyComponentManifest(root,unchangedSourceManifest,unchangedSourceManifest.files.map(file=>file.path),
    reportProgress('Unchanged source'))
  for(const [path,old] of oldNativeByPath){
    const current=planByPath.get(path)
    if(!current)throw Error('Previously packaged native source is now missing')
    if((current.bytes!==old.bytes||current.sha256!==undefined)&&!allowedNativeChanges.has(path))
      throw Error(`Native source changed outside approved scope: ${path}`)
  }
  const modelCount=plan.files.filter(file=>file.path.startsWith('models/language/')).length
  if(inner.hardlinked+inner.copiedModelFiles!==modelCount)
    throw Error('Existing model-copy provenance no longer matches the packaged model count')

  const policy=inspectSingleAppPolicy(root)
  const shell=join(output,'win-unpacked')
  if(!existsSync(output)){
    const config={...nativeBuilderConfig(app,'unused-native-suite',output),extraResources:[]}
    await build({projectDir:app,config,publish:'never',targets:Platform.WINDOWS.createTarget('dir',Arch.x64)})
  }
  if(existsSync(join(shell,'resources/NoriSuite')))
    throw Error('Shell-only build unexpectedly contains a native suite copy')
  verifyPackagedAppIdentity(shell,policy)
  const packagedBridge=extractFile(join(shell,'resources/app.asar'),'bridge/local-chat.mjs')
  const packagedRuntime=extractFile(join(shell,'resources/app.asar'),'desktop/gpt-oss-service.cjs')
  for(const [path,bytes] of [[changedNativeSources[0],packagedBridge],[changedNativeSources[1],packagedRuntime]]){
    const expected=readFileSync(join(root,path))
    if(!createHash('sha256').update(bytes).digest().equals(createHash('sha256').update(expected).digest()))
      throw Error(`Packaged application does not contain approved source: ${path}`)
  }
  recheckSingleAppPolicy(root,policy)

  const builtPaths=desktopArtifactPaths(shell)
  const oldPathSet=new Set(oldDesktopPaths),builtPathSet=new Set(builtPaths)
  const missingFromShell=oldDesktopPaths.filter(path=>!builtPathSet.has(path))
  const unexpectedInShell=builtPaths.filter(path=>!oldPathSet.has(path))
  const packageSupportPath=path=>path==='nori-components.json'||path.startsWith('backup-tools/')||path.startsWith('maintenance/')
  if(unexpectedInShell.length||missingFromShell.some(path=>!packageSupportPath(path)))
    throw Error('Electron shell artifact set differs beyond known package support files; candidate preserved')
  // package-native-desktop adds these verified diagnostics after electron-builder.
  // Carry forward the candidate's exact bytes because they are unchanged by this source fix.
  for(const path of missingFromShell){
    const expected=original.desktopManifest.files.find(file=>file.path===path)
    if(!expected)throw Error(`Packaged support file is absent from the verified old manifest: ${path}`)
    const target=join(shell,...path.split('/'))
    mkdirSync(dirname(target),{recursive:true})
    copyFileSync(join(desktop,...path.split('/')),target)
    verifyComponentManifest(shell,{schema_version:1,algorithm:'sha256',release_qualified:false,files:[expected]},[path])
  }
  const newDesktopPaths=desktopArtifactPaths(shell)
  if(oldDesktopPaths.length!==newDesktopPaths.length||oldDesktopPaths.some((path,index)=>path!==newDesktopPaths[index]))
    throw Error('Electron shell artifact set remains different after package support files were restored')
  const newDesktopManifest=buildComponentManifest(shell,newDesktopPaths)
  const oldDesktopByPath=new Map(original.desktopManifest.files.map(file=>[file.path,file]))
  const newDesktopByPath=new Map(newDesktopManifest.files.map(file=>[file.path,file]))
  const changedDesktopPaths=newDesktopPaths.filter(path=>{
    const before=oldDesktopByPath.get(path),after=newDesktopByPath.get(path)
    return before.bytes!==after.bytes||before.sha256!==after.sha256
  })

  // Preserve only the replaced shell files, changed native source modules, and receipts.
  mkdirSync(rollback,{recursive:false})
  const rollbackEntries=[]
  const saveFile=(source,relativePath,category)=>{
    const target=join(rollback,category,...relativePath.split('/'))
    mkdirSync(dirname(target),{recursive:true})
    copyFileSync(source,target)
    const info=statSync(source)
    const hash=createHash('sha256').update(readFileSync(target)).digest('hex')
    rollbackEntries.push({category,path:relativePath,bytes:info.size,sha256:hash})
  }
  for(const path of changedDesktopPaths)saveFile(join(desktop,...path.split('/')),path,'desktop')
  for(const path of changedNativeSources)saveFile(join(suite,...path.split('/')),path,'native')
  saveFile(outerPath,'native-desktop-receipt.json','receipts')
  saveFile(innerPath,'native-payload-receipt.json','receipts')
  writeFileSync(join(rollback,'refresh-rollback-manifest.json'),JSON.stringify({schema:1,candidate,
    selectedBeforeRefresh:false,changedDesktopPaths,changedNativeSources,previouslyAbsentNativeFiles:expectedNewFiles,
    files:rollbackEntries},null,2)+'\n',{flag:'wx'})

  let applied=false
  try{
    for(const path of changedDesktopPaths)copyFileSync(join(shell,...path.split('/')),join(desktop,...path.split('/')))
    for(const path of changedNativeSources)copyFileSync(join(root,path),join(suite,...path.split('/')))
    for(const path of expectedNewFiles){
      const target=join(suite,...path.split('/'))
      if(!existsSync(target))copyFileSync(join(root,...path.split('/')),target)
    }

    const updatedNativeFiles=[]
    for(const file of oldNativeByPath.values()){
      if(!allowedNativeChanges.has(file.path))updatedNativeFiles.push(file)
      else{
        const source=join(root,...file.path.split('/')),target=join(suite,...file.path.split('/'))
        const expected=planByPath.get(file.path)
        const [sourceHash,targetHash]=await Promise.all([sha256(source),sha256(target)])
        if(!expected||statSync(source).size!==expected.bytes||statSync(target).size!==expected.bytes||sourceHash!==targetHash)
          throw Error(`Updated native module does not match source: ${file.path}`)
        updatedNativeFiles.push({path:file.path,bytes:expected.bytes,sha256:targetHash})
      }
    }
    const nativeManifest={...original.nativeManifest,files:updatedNativeFiles}
    for(const path of expectedNewFiles){
      const current=planByPath.get(path)
      const source=join(root,...path.split('/')),target=join(suite,...path.split('/'))
      const [sourceHash,targetHash]=await Promise.all([sha256(source),sha256(target)])
      if(!current||statSync(source).size!==current.bytes||statSync(target).size!==current.bytes||sourceHash!==targetHash)
        throw Error(`New portable CUDA file does not match source: ${path}`)
      nativeManifest.files.push({path,bytes:current.bytes,sha256:targetHash})
    }
    nativeManifest.files.sort((a,b)=>a.path.localeCompare(b.path))
    if(nativeManifest.files.length!==plan.files.length||
       nativeManifest.files.some(file=>file.bytes!==planByPath.get(file.path)?.bytes))
      throw Error('Updated native manifest does not match the approved source plan')
    const nativeBytes=nativeManifest.files.reduce((sum,file)=>sum+file.bytes,0)
    const refreshedInner={...plan,manifest:nativeManifest,copied:plan.files.length,
      hardlinked:inner.hardlinked,copiedModelFiles:inner.copiedModelFiles,copyVerified:true,startupVerified:false}
    const totalBytes=nativeBytes+newDesktopManifest.files.reduce((sum,file)=>sum+file.bytes,0)
    const refreshedOuter={...original,desktopManifest:newDesktopManifest,nativeManifest,totalBytes,
      packagedAppIdentityVerified:true,packagedPayloadMatches:true,installedSuiteVerified:false,currentSelected:false}
    writeFileSync(join(rollback,'native-payload-receipt-r2.json'),JSON.stringify(refreshedInner,null,2)+'\n',{flag:'wx'})
    writeFileSync(join(rollback,'native-desktop-receipt-r2.json'),JSON.stringify(refreshedOuter,null,2)+'\n',{flag:'wx'})
    // Recheck exact changed sets; all unchanged entries were just verified against the old manifest.
    verifyComponentManifest(desktop,newDesktopManifest,newDesktopPaths,reportProgress('Refreshed desktop'))
    verifyComponentManifest(suite,nativeManifest,nativeDistributionPaths(suite),reportProgress('Refreshed native suite'))
    writeFileSync(`${innerPath}.refresh-r2.tmp`,JSON.stringify(refreshedInner,null,2)+'\n',{flag:'wx'})
    writeFileSync(`${outerPath}.refresh-r2.tmp`,JSON.stringify(refreshedOuter,null,2)+'\n',{flag:'wx'})
    renameSync(`${innerPath}.refresh-r2.tmp`,innerPath)
    renameSync(`${outerPath}.refresh-r2.tmp`,outerPath)
    const verifiedInner=JSON.parse(readFileSync(innerPath,'utf8'))
    const verifiedOuter=JSON.parse(readFileSync(outerPath,'utf8'))
    if(JSON.stringify(verifiedOuter.nativeManifest)!==JSON.stringify(verifiedInner.manifest)||
       verifiedOuter.currentSelected!==false||verifiedOuter.installedSuiteVerified!==false)
      throw Error('Refreshed candidate receipts failed their consistency check')
    applied=true
    return {candidate,selected:false,changedDesktopFiles:changedDesktopPaths.length,
      nativeFiles:nativeManifest.files.length,totalBytes,rollback,verified:true}
  }catch(error){
    for(const path of changedDesktopPaths){
      const source=join(rollback,'desktop',...path.split('/'))
      if(existsSync(source))copyFileSync(source,join(desktop,...path.split('/')))
    }
    for(const path of changedNativeSources){
      const source=join(rollback,'native',...path.split('/'))
      if(existsSync(source))copyFileSync(source,join(suite,...path.split('/')))
    }
    for(const path of expectedNewFiles){const target=join(suite,...path.split('/'));if(existsSync(target))unlinkSync(target)}
    for(const [source,target] of [[join(rollback,'receipts','native-desktop-receipt.json'),outerPath],
      [join(rollback,'receipts','native-payload-receipt.json'),innerPath]])copyFileSync(source,target)
    for(const target of [`${innerPath}.refresh-r2.tmp`,`${outerPath}.refresh-r2.tmp`])if(existsSync(target))unlinkSync(target)
    throw error
  }finally{
    if(applied)console.log(JSON.stringify({candidate,selected:false,changedDesktopFiles:changedDesktopPaths.length,
      nativeFiles:plan.files.length,rollback,verified:true}))
  }
})
