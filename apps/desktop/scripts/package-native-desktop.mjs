import {existsSync,readFileSync,writeFileSync,realpathSync,statSync,lstatSync,mkdirSync,copyFileSync,constants,renameSync} from 'node:fs'
import {join,resolve,dirname,isAbsolute,relative} from 'node:path'
import {pathToFileURL} from 'node:url'
import {createRequire} from 'node:module'
import {verifyNativePayload} from './verify-native-payload.mjs'
import {verifyComponentManifest,buildComponentManifest} from './component-integrity.mjs'
import {desktopArtifactPaths} from './desktop-artifacts.mjs'
import {nativeDistributionPaths} from './native-distribution-inventory.mjs'
import {suiteComponents} from './suite-components.mjs'
import {verifyNativeSdkIsolation} from './native-sdk-package-policy.mjs'
import {stageNativePayload} from './stage-native-payload.mjs'
import {verifiedHardlink,verifiedCopy} from './verified-copy.mjs'
import {journalWorkflow} from './project-workflow-journal.mjs'
import {inspectSingleAppPolicy,recheckSingleAppPolicy,verifyPackagedAppIdentity} from './single-app-package-policy.mjs'
const {load:loadYaml}=createRequire(import.meta.url)('js-yaml')

export const nativeMaintenanceScripts=Object.freeze([
  'provision-wake-profile.ps1',
  'verify-installed-native.mjs','desktop-artifacts.mjs','native-distribution-inventory.mjs',
  'publish-installed-layout.mjs','stage-core-private-state.mjs','private-state-plan.mjs','private-state-integrity.mjs',
  'stage-desktop-state-layout.mjs','desktop-state-split-plan.mjs','verify-desktop-state-copy.mjs',
  'component-integrity.mjs','provision-private-state.ps1','verify-private-state-acl.ps1',
  'verify-browser-state-acl.ps1','browser-capability-sid.ps1','recover-state-owner.ps1',
])

// Ship recovery alongside the app, with checked source/copy bytes. This only
// packages tools: never run recovery or alter any user's state during a build.
export function copyNativeMaintenanceScripts(appRoot,desktopRoot){
  const source=join(resolve(appRoot),'scripts'),root=resolve(desktopRoot)
  const normalize=value=>process.platform==='win32'?value.toLowerCase():value
  for(const path of [source,root])if(lstatSync(path).isSymbolicLink()||!statSync(path).isDirectory()||
    normalize(realpathSync(path))!==normalize(path))throw Error('Linked maintenance source or output refused')
  const manifest=buildComponentManifest(source,nativeMaintenanceScripts)
  const destination=join(root,'maintenance','scripts')
  if(existsSync(join(root,'maintenance')))throw Error('Existing maintenance output preserved')
  mkdirSync(destination,{recursive:true})
  for(const name of nativeMaintenanceScripts)copyFileSync(join(source,name),join(destination,name),constants.COPYFILE_EXCL)
  verifyComponentManifest(source,manifest,nativeMaintenanceScripts)
  verifyComponentManifest(destination,manifest,nativeMaintenanceScripts)
  return {destination,files:nativeMaintenanceScripts.length,copyIntegrityVerified:true,stateModified:false}
}

export function nativeBuilderConfig(appRoot,stage,output) {
  const base=loadYaml(readFileSync(join(appRoot,'electron-builder.native.yml'),'utf8'))
  // Builder inheritance concatenates resource arrays. Materialize one config
  // instead, so old and new stages never race to copy into the same directory.
  return {...base,extends:null,directories:{...base.directories,output},
    extraResources:[{from:stage,to:'NoriSuite',filter:['**/*','!state{,/**/*}',
      '!verification{,/**/*}','!**/__pycache__{,/**/*}','!**/*.pyc','!native-payload-receipt.json',
      '!models/language{,/**/*}']}]}
}

export function restorePackagedModelLinks(stage,desktopRoot,receipt,{createHardlink=verifiedHardlink,copyFile=verifiedCopy}={}){
  const config=JSON.parse(readFileSync(join(stage,'runtime/norllama/config.json'),'utf8'))
  const activeModelPath=config.model_path
  if(typeof activeModelPath!=='string'||!/^models\/language\/[A-Za-z0-9._/-]+\.gguf$/.test(activeModelPath)||
    activeModelPath.split('/').some(part=>!part||part==='.'||part==='..'))
    throw new Error('Unsafe active model path in staged Nori runtime configuration')
  const entries=receipt.manifest?.files?.filter(file=>file.path.startsWith('models/language/'))??[]
  if(!entries.some(file=>file.path===activeModelPath)||!entries.length)
    throw new Error('Active model is absent from the verified native payload manifest')
  return entries.map(entry=>{
    if(entry.path.split('/').some(part=>!part||part==='.'||part==='..')||
      !Number.isSafeInteger(entry.bytes)||entry.bytes<0||!/^[a-f0-9]{64}$/.test(entry.sha256??''))
      throw new Error('Unsafe or unverified language-model package entry')
    const segments=entry.path.split('/')
    const source=join(stage,...segments)
    const destination=join(desktopRoot,'resources','NoriSuite',...segments)
    let result
    if(entry.path==='models/language/gpt-oss-20b-ggmlorg-mxfp4-a7443ebb/gpt-oss-20b-mxfp4.gguf'){
      copyFile(source,destination,entry.sha256)
      result={status:'copied',sha256:entry.sha256}
    }else{
      try{result=createHardlink(source,destination,entry.sha256,join(desktopRoot,'resources','NoriSuite'))}
      catch(error){
        if(error?.code!=='EXDEV')throw error
        copyFile(source,destination,entry.sha256)
        result={status:'copied',sha256:entry.sha256}
      }
    }
    return {path:entry.path,bytes:entry.bytes,...result}
  })
}

export function selectBuiltCandidate(appRoot,candidate,selectCurrent=false) {
  if(typeof selectCurrent!=='boolean')throw Error('Explicit boolean selection required')
  if(!selectCurrent)return false
  if(typeof candidate!=='string'||!/^[a-z0-9][a-z0-9-]{0,63}$/.test(candidate))throw Error('Unsafe native candidate name')
  if(!existsSync(join(appRoot,`release/native-desktop-${candidate}/win-unpacked/Nori.exe`)))throw Error('Built candidate executable missing')
  const currentPointer=join(appRoot,'release','current-desktop.txt')
  const temporaryPointer=`${currentPointer}.${candidate}.tmp`
  writeFileSync(temporaryPointer,`${candidate}\n`,{flag:'wx'})
  renameSync(temporaryPointer,currentPointer)
  return true
}

export async function packageNativeDesktop(sourceRoot, buildCandidate, {candidate='current',stageCandidate=candidate,selectCurrent=false,portableCatalog,stagePath,outputPath}={}) {
  if(typeof selectCurrent!=='boolean')throw Error('Explicit boolean selection required')
  if (typeof candidate === 'string' && candidate.startsWith('native-desktop-')) {
    candidate = candidate.slice('native-desktop-'.length)
  }
  if (typeof stageCandidate === 'string') {
    if (stageCandidate.startsWith('native-desktop-')) stageCandidate = stageCandidate.slice('native-desktop-'.length)
    else if (stageCandidate.startsWith('native-suite-')) stageCandidate = stageCandidate.slice('native-suite-'.length)
  }
  for(const name of [candidate,stageCandidate]) {
    if(typeof name!=='string'||!/^[a-z0-9][a-z0-9-]{0,63}$/.test(name)) throw new Error('Unsafe native candidate name')
  }
  const root=resolve(sourceRoot)
  const appRoot=join(root,'apps/desktop')
  const normalize=value=>process.platform==='win32'?value.toLowerCase():value
  const stage=stagePath===undefined?join(appRoot,`release/native-suite-${stageCandidate}/NoriSuite`):resolve(stagePath)
  const output=outputPath===undefined?join(appRoot,`release/native-desktop-${candidate}`):resolve(outputPath)
  if(stagePath!==undefined) {
    if(!isAbsolute(stagePath)||!existsSync(stage)||lstatSync(stage).isSymbolicLink()||
      !statSync(stage).isDirectory()||normalize(realpathSync(stage))!==normalize(stage))
      throw Error('External native staging path must be an existing physical directory')
  }
  if(outputPath!==undefined) {
    if(!isAbsolute(outputPath))throw Error('External native output path must be absolute')
    const outputDelta=relative(root,output).replaceAll('\\','/')
    if(!isAbsolute(outputDelta)&&!outputDelta.startsWith('../')&&
      !outputDelta.startsWith('apps/desktop/release/'))
      throw Error('External native output must be outside the source tree or under desktop release')
  }
  const outputRelativeToStage=relative(stage,output).replaceAll('\\','/')
  if(!isAbsolute(outputRelativeToStage)&&outputRelativeToStage!==''&&!outputRelativeToStage.startsWith('../'))
    throw Error('Native desktop output cannot be nested inside the staged payload')
  if(existsSync(output)) throw new Error('Native desktop output already exists; previous candidate preserved')
  let ancestor=dirname(output)
  while(!existsSync(ancestor))ancestor=dirname(ancestor)
  if(!statSync(ancestor).isDirectory()||normalize(realpathSync(ancestor))!==normalize(ancestor))
    throw Error('Linked native build output ancestor refused')
  const singleAppPolicy=inspectSingleAppPolicy(root)
  const verified=verifyNativePayload(root,stage,{portableCatalog})
  if(!existsSync(join(appRoot,'dist/index.html'))) throw new Error('Built desktop renderer is missing')
  const options={projectDir:appRoot,config:nativeBuilderConfig(appRoot,stage,output),publish:'never'}
  if(buildCandidate) await buildCandidate(options)
  else {
    const {build,Platform,Arch}=await import('electron-builder')
    await build({...options,targets:Platform.WINDOWS.createTarget('dir',Arch.x64)})
  }
  // Reject a source change during packaging, rather than treating an earlier
  // verification as an indefinitely valid authorization to release.
  verifyNativePayload(root,stage,{portableCatalog})
  recheckSingleAppPolicy(root,singleAppPolicy)
  const receipt=JSON.parse(readFileSync(join(stage,'native-payload-receipt.json'),'utf8'))
  const packagedModels=restorePackagedModelLinks(stage,join(output,'win-unpacked'),receipt)
  verifyComponentManifest(join(output,'win-unpacked/resources/NoriSuite'),receipt.manifest,
    nativeDistributionPaths(join(output,'win-unpacked/resources/NoriSuite')))
  const desktopRoot=join(output,'win-unpacked')
  verifyPackagedAppIdentity(desktopRoot,singleAppPolicy)
  const sdkPolicy=verifyNativeSdkIsolation(desktopRoot)
  // Keep the verifier beside the application, not dependent on the source
  // checkout. These files are themselves covered by the desktop manifest.
  const backupTools=join(desktopRoot,'backup-tools')
  mkdirSync(backupTools)
  for(const name of ['verify-portable-native.mjs','component-integrity.mjs',
    'desktop-artifacts.mjs','native-distribution-inventory.mjs','check-native-backup.ps1'])
    copyFileSync(join(import.meta.dirname,name),join(backupTools,name),constants.COPYFILE_EXCL)
  const maintenance=join(desktopRoot,'maintenance')
  copyNativeMaintenanceScripts(appRoot,desktopRoot)
  mkdirSync(join(maintenance,'desktop'))
  for(const name of ['state-owner.cjs','native-state-layout.cjs','desktop-state-selection.cjs',
    'consolidated-state-selection.cjs','installed-state-policy.cjs'])
    copyFileSync(join(import.meta.dirname,'../desktop',name),
      join(maintenance,'desktop',name),constants.COPYFILE_EXCL)
  copyFileSync(join(import.meta.dirname,'probe-packaged-consolidated.cjs'),
    join(maintenance,'desktop','probe-packaged-consolidated.cjs'),constants.COPYFILE_EXCL)
  // The packaged GUI probe is self-contained and must carry its deadline
  // policy beside it; otherwise its packaged entrypoint cannot be executed.
  copyFileSync(join(import.meta.dirname,'probe-deadlines.cjs'),
    join(maintenance,'desktop','probe-deadlines.cjs'),constants.COPYFILE_EXCL)
  writeFileSync(join(desktopRoot,'nori-components.json'),JSON.stringify(suiteComponents(desktopRoot),null,2)+'\n',{flag:'wx'})
  const desktopManifest=buildComponentManifest(desktopRoot,desktopArtifactPaths(desktopRoot))
  const totalBytes=verified.bytes+desktopManifest.files.reduce((sum,file)=>sum+file.bytes,0)
  if(!Number.isSafeInteger(totalBytes)||totalBytes>=128_000_000_000)throw Error('Complete native suite exceeds 128 GB size limit')
  // The model and staged payload may be hard-linked; bind the final receipt
  // to bytes that still match both the source tree and the original manifest.
  verifyNativePayload(root,stage,{portableCatalog})
  verifyComponentManifest(join(desktopRoot,'resources/NoriSuite'),receipt.manifest,
    nativeDistributionPaths(join(desktopRoot,'resources/NoriSuite')))
  recheckSingleAppPolicy(root,singleAppPolicy)
  writeFileSync(join(output,'native-desktop-receipt.json'),JSON.stringify({schema:1,candidate,stageCandidate,
    desktopManifest,nativeManifest:receipt.manifest,packagedModels,totalBytes,singleAppPolicy,packagedAppIdentityVerified:true,
    packagedPayloadMatches:true,nativeSdkIsolated:sdkPolicy.nativeSdkIsolated,installedSuiteVerified:false},null,2)+'\n',{flag:'wx'})
  // Building an experimental candidate must not silently change the everyday app.
  const currentSelected=selectBuiltCandidate(appRoot,candidate,selectCurrent)
  return {...verified,output,totalBytes,currentSelected,packagedPayloadMatches:true,installedSuiteVerified:false}
}
export function nativePackageArguments(argumentsList) {
  const options={}
  for(let index=0;index<argumentsList.length;index++){
    const argument=argumentsList[index]
    if(argument==='--select-current') {
      if(options.selectCurrent!==undefined)throw Error('Expected unique safe selection argument')
      options.selectCurrent=true
      continue
    }
    if(argument==='--stage-path'||argument==='--output-path') {
      const key=argument==='--stage-path'?'stagePath':'outputPath'
      const value=argumentsList[++index]
      const absolute=typeof value==='string'&&(/^[a-zA-Z]:[\\/]/.test(value)||value.startsWith('\\\\')||isAbsolute(value))
      if(options[key]!==undefined||!absolute)
        throw Error('Expected unique absolute native package path')
      options[key]=value
      continue
    }
    const match=/^--(candidate|stageCandidate)=([a-z0-9][a-z0-9-]{0,63})$/.exec(argument)
    if(!match||options[match[1]]!==undefined)throw Error('Expected unique safe --candidate= and --stageCandidate= arguments')
    options[match[1]]=match[2]
  }
  return options
}
if(process.argv[1] && import.meta.url===pathToFileURL(resolve(process.argv[1])).href) {
  await journalWorkflow('package','native-desktop','apps/desktop/scripts/package-native-desktop.mjs',async()=>{
  const options=nativePackageArguments(process.argv.slice(2))
  if(!options.candidate) {
    options.candidate=`live-${new Date().toISOString().replace(/\D/g,'').slice(0,17)}`
    if(!options.stageCandidate) {
      options.stageCandidate=options.candidate
      const root=resolve(import.meta.dirname,'../../..')
      const stage=join(root,'apps/desktop',`release/native-suite-${options.stageCandidate}/NoriSuite`)
      const result=stageNativePayload(root,stage)
      console.log(JSON.stringify({stage,files:result.copied,bytes:result.bytes,copyVerified:true}))
    }
  }
  console.log(JSON.stringify(await packageNativeDesktop(resolve(import.meta.dirname,'../../..'),undefined,options)))
  })
}
