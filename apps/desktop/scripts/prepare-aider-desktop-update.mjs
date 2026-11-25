import {createRequire} from 'node:module'
import {createHash} from 'node:crypto'
import {readFileSync,writeFileSync,mkdirSync,existsSync,copyFileSync,realpathSync,renameSync} from 'node:fs'
import {resolve,join,dirname,sep} from 'node:path'
import {verifyComponentManifest} from './component-integrity.mjs'

const require=createRequire(import.meta.url)
const {extractAll,extractFile,listPackage,statFile,createPackage}=require('@electron/asar')
const [codeArgument,payloadArgument,installedArgument,outputArgument]=process.argv.slice(2)
if(!codeArgument||!payloadArgument||!installedArgument||!outputArgument)
  throw Error('Expected reviewed source, verified coder payload, installed app, and update staging folder')
const code=realpathSync(codeArgument),payload=realpathSync(payloadArgument),installed=realpathSync(installedArgument),output=resolve(outputArgument)
const hash=bytes=>createHash('sha256').update(bytes).digest('hex')
const bridgeFiles=['local-chat.mjs','nori-v2-query.mjs','aider-tools.mjs']
const sourceArchive=join(installed,'resources/app.asar')
const resume=process.argv[6]==='--resume'
if(existsSync(output)&&!resume)throw Error('Existing desktop update preserved')
const planPath=join(output,'update-plan.json')
if(existsSync(planPath)){
  const prior=JSON.parse(readFileSync(planPath,'utf8'))
  const currentHash=hash(readFileSync(sourceArchive))
  const applied=existsSync(join(output,'installed-result.json')) &&
    JSON.parse(readFileSync(join(output,'installed-result.json'),'utf8').replace(/^\uFEFF/,''))?.installed===true
  const appliedBase=applied && prior.entries.some(entry=>entry.relative==='resources/app.asar' && entry.sha256===currentHash)
  if(prior.schema!=='nori.aider.desktop-update.v1'||prior.installedRoot!==installed||
    (prior.originalArchiveSha256!==currentHash&&!appliedBase))throw Error('Installed base changed; prepared update preserved')
}
const coder=JSON.parse(readFileSync(join(payload,'aider-payload-receipt.json'),'utf8'))
if(!coder.copyVerified||coder.aiderVersion!=='0.86.2')throw Error('Unverified coder payload')
verifyComponentManifest(payload,coder.manifest,coder.manifest.files.map(file=>file.path))
if(!existsSync(output))mkdirSync(output)
if(realpathSync(output).toLowerCase()!==output.toLowerCase())throw Error('Linked update staging refused')
const extracted=join(output,'archive-source'),archive=join(output,'app.asar')
if(!resume)extractAll(sourceArchive,extracted)
for(const file of bridgeFiles){
  const source=join(code,'apps/desktop/bridge',file),destination=join(extracted,'bridge',file)
  mkdirSync(dirname(destination),{recursive:true});copyFileSync(source,destination)
}
await createPackage(extracted,archive)
const names=path=>listPackage(path).filter(name=>!statFile(path,name.slice(1)).files)
  .map(name=>name.slice(1).replaceAll('\\','/'))
const beforeNames=names(sourceArchive),afterNames=names(archive),changes=[]
const archiveBytes=(archive,name)=>{
  const nativeName=name.split('/').join(sep)
  const info=statFile(archive,nativeName,false)
  return info.link?Buffer.from('asar-link:'+info.link):extractFile(archive,nativeName)
}
for(const name of new Set([...beforeNames,...afterNames])){
  const old=beforeNames.includes(name)?archiveBytes(sourceArchive,name):null
  const next=afterNames.includes(name)?archiveBytes(archive,name):null
  if(old&&next&&old.equals(next))continue
  if(!bridgeFiles.some(file=>name==='bridge/'+file)||!next)throw Error('Unexpected archive change: '+name)
  if(!next.equals(readFileSync(join(code,'apps/desktop',name))))throw Error('Archive/source mismatch')
  changes.push(name)
}
if(!changes.includes('bridge/aider-tools.mjs'))throw Error('Coder bridge is missing from the updated archive')
const entries=[]
function entry(source,relative){
  const target=join(installed,relative),bytes=readFileSync(source)
  const sha256=hash(bytes),beforeSha256=existsSync(target)?hash(readFileSync(target)):null
  if(sha256===beforeSha256)return
  entries.push({source,relative,bytes:bytes.length,sha256,beforeSha256})
}
entry(archive,'resources/app.asar')
for(const file of bridgeFiles)entry(join(code,'apps/desktop/bridge',file),'resources/NoriSuite/apps/desktop/bridge/'+file)
for(const file of coder.manifest.files)entry(join(payload,file.path),'resources/NoriSuite/'+file.path)
const components=JSON.parse(readFileSync(join(installed,'nori-components.json'),'utf8'))
components.components=components.components.filter(component=>component.id!=='aider-coder')
components.components.push({id:'aider-coder',kind:'bundled-local-coding-worker',
  path:'resources/NoriSuite/integrations/aider',version:'0.86.2',
  modelId:'gpt-oss-20b',interpreter:'resources/NoriSuite/python/Python311/python.exe',
  git:'resources/NoriSuite/integrations/aider/git/mingw64/bin/git.exe',releaseQualified:false})
writeFileSync(join(output,'nori-components.json'),JSON.stringify(components,null,2)+'\n',{flag:resume?'w':'wx'})
entry(join(output,'nori-components.json'),'nori-components.json')
const plan={schema:'nori.aider.desktop-update.v1',installedRoot:installed,
  originalArchiveSha256:hash(readFileSync(sourceArchive)),changedArchiveFiles:changes,
  entries,bytes:entries.reduce((sum,file)=>sum+file.bytes,0),modelsCopied:0,
  installed:false,desktopUiTested:false,fullReleaseVerified:false}
if(existsSync(planPath))renameSync(planPath,join(output,'update-plan.previous.json'))
writeFileSync(planPath,JSON.stringify(plan,null,2)+'\n',{flag:'wx'})
console.log(JSON.stringify({prepared:true,output,files:entries.length,bytes:plan.bytes,changedArchiveFiles:changes,modelsCopied:0}))

