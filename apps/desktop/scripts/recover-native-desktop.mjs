// Finish an interrupted package only after validating its existing bytes.
// No copying, model loading, selection, installation, or replacement occurs.
import {existsSync,readFileSync,writeFileSync,lstatSync,realpathSync} from 'node:fs'
import {join,resolve,sep} from 'node:path'
import {createHash} from 'node:crypto'
import {createRequire} from 'node:module'
import {pathToFileURL} from 'node:url'
import {verifyNativePayload} from './verify-native-payload.mjs'
import {buildComponentManifest,verifyComponentManifest} from './component-integrity.mjs'
import {nativeDistributionPaths} from './native-distribution-inventory.mjs'
import {desktopArtifactPaths} from './desktop-artifacts.mjs'
import {inspectSingleAppPolicy,recheckSingleAppPolicy,verifyPackagedAppIdentity} from './single-app-package-policy.mjs'
import {verifyNativeSdkIsolation} from './native-sdk-package-policy.mjs'
import {nativePackageArguments,nativeMaintenanceScripts} from './package-native-desktop.mjs'
import {journalWorkflow} from './project-workflow-journal.mjs'

const hash=bytes=>createHash('sha256').update(bytes).digest('hex')
const normalize=value=>process.platform==='win32'?value.toLowerCase():value
export function recoverNativeDesktop(root,{candidate,stageCandidate=candidate},{progress=console.log}={}) {
  for(const id of [candidate,stageCandidate])
    if(typeof id!=='string'||!/^[a-z0-9][a-z0-9-]{0,63}$/.test(id))throw Error('Unsafe candidate identity')
  root=resolve(root)
  const app=join(root,'apps/desktop'),output=join(app,`release/native-desktop-${candidate}`)
  const desktop=join(output,'win-unpacked'),suite=join(desktop,'resources/NoriSuite')
  const stage=join(app,`release/native-suite-${stageCandidate}/NoriSuite`)
  const destination=join(output,'native-desktop-receipt.json')
  if(existsSync(destination))throw Error('Existing completion receipt preserved')
  for(const path of [root,output,desktop,suite,stage])
    if(lstatSync(path).isSymbolicLink()||!lstatSync(path).isDirectory()||normalize(realpathSync(path))!==normalize(path))
      throw Error('Recovery requires physical candidate directories')
  const policy=inspectSingleAppPolicy(root)
  verifyPackagedAppIdentity(desktop,policy)
  const {listPackage,statFile,extractFile}=createRequire(import.meta.url)('@electron/asar')
  const archive=join(desktop,'resources/app.asar')
  let archiveFiles=0
  for(const entry of listPackage(archive)) {
    const relative=entry.replaceAll('\\','/').replace(/^\//,'')
    if(!/^(dist|desktop|bridge|public)\//.test(relative))continue
    const info=statFile(archive,relative.split('/').join(sep))
    if(info.files)continue
    if(info.link||relative.split('/').some(part=>!part||part==='.'||part==='..'))throw Error('Archive contains redirected source')
    const source=join(app,...relative.split('/'))
    if(!lstatSync(source).isFile()||hash(readFileSync(source))!==hash(extractFile(archive,relative.split('/').join(sep))))
      throw Error('Packaged source differs: '+relative)
    archiveFiles++
  }
  if(archiveFiles<20)throw Error('Incomplete renderer/source archive')
  progress(JSON.stringify({phase:'archive-source-matches',files:archiveFiles}))
  const verified=verifyNativePayload(root,stage)
  progress(JSON.stringify({phase:'source-and-stage-match',files:verified.files,bytes:verified.bytes}))
  const receipt=JSON.parse(readFileSync(join(stage,'native-payload-receipt.json'),'utf8'))
  verifyComponentManifest(suite,receipt.manifest,nativeDistributionPaths(suite),{
    onFile:({verifiedFiles})=>{if(verifiedFiles%5000===0)progress(JSON.stringify({phase:'package-verification',files:verifiedFiles}))},
  })
  const paired=[
    ...nativeMaintenanceScripts.map(name=>['scripts/'+name,'maintenance/scripts/'+name]),
    ...['state-owner.cjs','native-state-layout.cjs','desktop-state-selection.cjs','consolidated-state-selection.cjs','installed-state-policy.cjs']
      .map(name=>['desktop/'+name,'maintenance/desktop/'+name]),
    ...['probe-packaged-consolidated.cjs','probe-deadlines.cjs'].map(name=>['scripts/'+name,'maintenance/desktop/'+name]),
    ...['verify-portable-native.mjs','component-integrity.mjs','desktop-artifacts.mjs','native-distribution-inventory.mjs','check-native-backup.ps1']
      .map(name=>['scripts/'+name,'backup-tools/'+name]),
  ]
  for(const [source,dest] of paired)
    if(hash(readFileSync(join(app,source)))!==hash(readFileSync(join(desktop,dest))))throw Error('Recovery tool differs: '+dest)
  const packagedModels=receipt.manifest.files.filter(file=>file.path.startsWith('models/language/')).map(file=>{
    const info=lstatSync(join(suite,file.path))
    if(file.path.includes('gpt-oss-20b-mxfp4.gguf')&&info.nlink!==1)throw Error('GPT-OSS must own an independent copy')
    return {...file,status:info.nlink===1?'copied':'linked'}
  })
  const sdkPolicy=verifyNativeSdkIsolation(desktop)
  const desktopManifest=buildComponentManifest(desktop,desktopArtifactPaths(desktop))
  const totalBytes=verified.bytes+desktopManifest.files.reduce((sum,file)=>sum+file.bytes,0)
  if(!Number.isSafeInteger(totalBytes)||totalBytes>=128_000_000_000)throw Error('Invalid complete suite size')
  recheckSingleAppPolicy(root,policy)
  const result={schema:1,candidate,stageCandidate,desktopManifest,nativeManifest:receipt.manifest,
    packagedModels,totalBytes,singleAppPolicy:policy,packagedAppIdentityVerified:true,
    packagedPayloadMatches:true,nativeSdkIsolated:sdkPolicy.nativeSdkIsolated,
    recoveredAfterInterruptedBuild:true,archiveSourceFilesVerified:archiveFiles,installedSuiteVerified:false}
  writeFileSync(destination,JSON.stringify(result,null,2)+'\n',{flag:'wx'})
  return {candidate,stageCandidate,totalBytes,receipt:destination,currentSelected:false,installedSuiteVerified:false}
}

if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href) {
  const options=nativePackageArguments(process.argv.slice(2))
  if(options.selectCurrent||options.stagePath||options.outputPath)throw Error('Recovery never changes selection or accepts alternate paths')
  await journalWorkflow('verify','recover-native-desktop','apps/desktop/scripts/recover-native-desktop.mjs',()=>{
    const result=recoverNativeDesktop(resolve(import.meta.dirname,'../../..'),options)
    console.log(JSON.stringify({phase:'completed',...result}))
  })
}
