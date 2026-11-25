import {spawnSync} from 'node:child_process'
import {existsSync,mkdirSync,readdirSync,lstatSync,readFileSync,writeFileSync,realpathSync,copyFileSync,constants} from 'node:fs'
import {join,resolve} from 'node:path'
import {pathToFileURL} from 'node:url'
import {createHash} from 'node:crypto'
import {nativeInstallerPlan,verifyNativeDesktopCandidate} from './native-installer-plan.mjs'
import {buildComponentManifest} from './component-integrity.mjs'
import {verifyNativeInstaller} from './verify-native-installer.mjs'
import {inspectSingleAppPolicy,recheckSingleAppPolicy,verifyPackagedAppIdentity} from './single-app-package-policy.mjs'
import {journalWorkflow} from './project-workflow-journal.mjs'

/** Use a temporary short drive alias for long Windows payload paths. Inno's
 * file enumerator otherwise fails on deep vendored paths beyond MAX_PATH. */
function mapCompilerSourceRoot(sourceRoot) {
  if (process.platform !== 'win32') return {root:sourceRoot,dispose(){}}
  const systemRoot=process.env.SystemRoot||'C:\\Windows'
  const subst=join(systemRoot,'System32','subst.exe')
  for(const letter of ['Z','Y','X','W','V','U','T','S','R','Q']){
    const drive=`${letter}:`
    if(existsSync(`${drive}\\`))continue
    const mapped=spawnSync(subst,[drive,sourceRoot],{shell:false,windowsHide:true,encoding:'utf8'})
    if(mapped.error||mapped.status!==0)continue
    return {root:drive,dispose(){
      const removed=spawnSync(subst,[drive,'/D'],{shell:false,windowsHide:true,encoding:'utf8'})
      if(removed.error||removed.status!==0)throw Error(`Could not remove temporary installer source mapping ${drive}`)
    }}
  }
  throw Error('No unused drive letter is available for the short installer source mapping')
}

/** Builds only. Never launches Setup, installs dependencies or removes outputs. */
export function buildNativeInstaller(root,options,{plan=nativeInstallerPlan,verify=verifyNativeDesktopCandidate,run=spawnSync,mapSourceRoot=mapCompilerSourceRoot}={}) {
  const singleAppPolicy=inspectSingleAppPolicy(root)
  const prepared=plan(root,options)
  verifyPackagedAppIdentity(prepared.desktop,singleAppPolicy)
  const recipe=prepared.argv.at(-1)
  const recipeHash=()=>createHash('sha256').update(readFileSync(recipe)).digest('hex')
  const before=recipeHash()
  mkdirSync(prepared.output) // Atomic refusal if another writer occupied the output.
  const sourceAlias=mapSourceRoot(prepared.desktop)
  let result
  try {
    const compilerArgs=prepared.argv.map(argument=>argument===`/DNativeDesktopRoot=${prepared.desktop}`
      ? `/DNativeDesktopRoot=${sourceAlias.root}` : argument)
    result=run(prepared.compiler,compilerArgs,{shell:false,windowsHide:true,
      encoding:'utf8',timeout:600000,maxBuffer:128*1024*1024})
  } finally { sourceAlias.dispose() }
  if(result.error||result.status!==0){
    const diagnostics=[result.stdout,result.stderr].filter(value=>typeof value==='string'&&value.trim())
      .map(value=>value.slice(-8000)).join('\n')
    throw Error('Native installer compiler failed; partial output preserved: '+(result.error?.code??result.status)+
      (diagnostics?'\n'+diagnostics:''))
  }
  const normalize=value=>process.platform==='win32'?value.toLowerCase():value
  if(lstatSync(prepared.output).isSymbolicLink()||!lstatSync(prepared.output).isDirectory()||
    normalize(realpathSync(prepared.output))!==normalize(resolve(prepared.output)))
    throw Error('Compiler output path changed or is linked; no receipt written')
  if(recipeHash()!==before)throw Error('Installer definition changed during compilation; output preserved')
  recheckSingleAppPolicy(root,singleAppPolicy)
  verify(root,options)
  verifyPackagedAppIdentity(prepared.desktop,singleAppPolicy)
  const paths=readdirSync(prepared.output)
  const stem='Nori-Native-Suite-Setup-x64'
  if(!paths.includes(stem+'.exe')||!paths.some(path=>new RegExp('^'+stem+'-\\d+[a-z]?\\.bin$').test(path)))
    throw Error('Compiler did not produce the expected installer and disk slices; output preserved')
  for(const path of paths){
    const info=lstatSync(join(prepared.output,path))
    if(info.isSymbolicLink()||!info.isFile()||info.size===0)throw Error('Unsafe or empty compiler output; preserved')
  }
  const manifest=buildComponentManifest(prepared.output,paths)
  const verificationTools=['verify-native-installer.mjs','component-integrity.mjs','check-native-installer.ps1']
  for(const name of verificationTools)
    copyFileSync(join(import.meta.dirname,name),join(prepared.output,name),constants.COPYFILE_EXCL)
  const verifierManifest=buildComponentManifest(prepared.output,verificationTools)
  const receipt={schema:1,candidate:options.candidate,stageCandidate:options.stageCandidate??options.candidate,
    compiled:true,singleAppPolicy,packagedAppIdentityVerified:true,installerRecipeSha256:before,manifest,verifierManifest,installedSuiteVerified:false,
    publisherAuthenticated:false,setupLaunched:false}
  verifyNativeInstaller(prepared.output,receipt)
  recheckSingleAppPolicy(root,singleAppPolicy)
  writeFileSync(join(prepared.output,'native-installer-receipt.json'),JSON.stringify(receipt,null,2)+'\n',{flag:'wx'})
  return {...receipt,output:prepared.output}
}

if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  await journalWorkflow('package','native-installer','apps/desktop/scripts/build-native-installer.mjs',()=>{
  const options={}
  for(const argument of process.argv.slice(2)){
    const match=/^--(candidate|stageCandidate|compiler)=(.+)$/.exec(argument)
    if(!match||options[match[1]]!==undefined)throw Error('Expected unique --candidate=, --stageCandidate=, --compiler= arguments')
    options[match[1]]=match[2]
  }
  console.log(JSON.stringify(buildNativeInstaller(resolve(import.meta.dirname,'../../..'),options)))
  })
}
