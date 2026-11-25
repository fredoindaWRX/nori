import {existsSync, mkdirSync, realpathSync, statSync, writeFileSync} from 'node:fs'
import {dirname, isAbsolute, join, relative, resolve} from 'node:path'
import {pathToFileURL} from 'node:url'
import {nativePayloadPlan} from './native-payload-plan.mjs'
import {verifiedCopy,verifiedHardlink} from './verified-copy.mjs'
import {buildComponentManifest,verifyComponentManifest} from './component-integrity.mjs'
import {journalWorkflow} from './project-workflow-journal.mjs'

export function stageNativePayload(sourceRoot, destination, {portableCatalog,createHardlink=verifiedHardlink,copyFile=verifiedCopy} = {}) {
  const root = realpathSync(sourceRoot)
  const target = resolve(destination)
  if (existsSync(target)) throw new Error('Native staging requires a fresh destination; existing files preserved')
  const plan = nativePayloadPlan(root,{portableCatalog})
  const paths = plan.files.map(file=>file.path)
  const manifest = buildComponentManifest(root,paths)
  // Do not allow a caller to replace a source component with staged output.
  const delta = relative(root,target).replaceAll('\\','/')
  if (!delta || (!isAbsolute(delta) && !delta.startsWith('../') && !delta.startsWith('apps/desktop/release/'))) {
    throw new Error('Staging inside Nori is restricted to desktop release output')
  }
  let ancestor = dirname(target)
  while (!existsSync(ancestor)) ancestor = dirname(ancestor)
  const physical = realpathSync(ancestor)
  const normalized = value => process.platform === 'win32' ? value.toLowerCase() : value
  if (normalized(physical) !== normalized(ancestor) || !statSync(ancestor).isDirectory()) {
    throw new Error('Staging destination ancestor is a link or not a directory')
  }
  mkdirSync(target,{recursive:true})
  let copied = 0
  let hardlinked = 0
  let copiedModelFiles = 0
  for (const file of plan.files) {
    const source = join(root,file.path)
    const actual = realpathSync(source)
    const current = relative(root,actual)
    if (current.startsWith('..') || isAbsolute(current) || statSync(source).size !== file.bytes) {
      throw new Error('Native source changed or escaped during staging; incomplete output retained')
    }
    const destination=join(target,file.path)
    if(file.path.startsWith('models/language/')){
      const expected=manifest.files.find(entry=>entry.path===file.path)?.sha256
      // Keep GPT-OSS independent in the portable suite: its runtime refuses
      // multiply-linked weights and the USB package must own the model bytes.
      if(file.path==='models/language/gpt-oss-20b-ggmlorg-mxfp4-a7443ebb/gpt-oss-20b-mxfp4.gguf'){
        copyFile(source,destination,expected)
        copiedModelFiles++
        copied++
        continue
      }
      try{
        createHardlink(source,destination,expected,target)
        hardlinked++
      }catch(error){
        if(error?.code!=='EXDEV')throw error
        copyFile(source,destination,expected)
        copiedModelFiles++
      }
    }else verifiedCopy(source,destination)
    copied++
  }
  // Bind every copy to one measured candidate, not merely whatever source
  // bytes happened to be present when its individual copy was performed.
  verifyComponentManifest(root,manifest,paths)
  verifyComponentManifest(target,manifest,paths)
  // This is a copy receipt, not permission to release or evidence of startup.
  const receipt = {...plan, manifest, copied, hardlinked,copiedModelFiles,copyVerified:true,startupVerified:false}
  writeFileSync(join(target,'native-payload-receipt.json'),JSON.stringify(receipt,null,2)+'\n',{flag:'wx'})
  return receipt
}

export function nativeStageArguments(argumentsList) {
  if(argumentsList.length===0)return {candidate:'current'}
  if(argumentsList.length===1) {
    const match=/^--candidate=([a-z0-9][a-z0-9-]{0,63})$/.exec(argumentsList[0])
    if(match)return {candidate:match[1]}
  }
  if(argumentsList.length===2&&argumentsList[0]==='--destination'&&
    typeof argumentsList[1]==='string'&&
    (/^[a-zA-Z]:[\\/]/.test(argumentsList[1])||argumentsList[1].startsWith('\\\\')||isAbsolute(argumentsList[1])))
    return {destination:argumentsList[1]}
  throw Error('Expected one safe --candidate= or an absolute --destination path')
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await journalWorkflow('package','native-stage','apps/desktop/scripts/stage-native-payload.mjs',()=>{
  const {candidate,destination}=nativeStageArguments(process.argv.slice(2))
  const root = resolve(import.meta.dirname,'../../..')
  const target = destination===undefined?join(root,`apps/desktop/release/native-suite-${candidate}/NoriSuite`):resolve(destination)
  const result = stageNativePayload(root,target)
  console.log(JSON.stringify({target,files:result.copied,bytes:result.bytes,copyVerified:true,startupVerified:false,releaseVerified:false}))
  })
}
