// Add runtime code omitted by the old directory-name exclusion. Preserve the
// old receipt and reuse all existing verified large files; never copy models.
import {readFileSync,writeFileSync,existsSync,renameSync,copyFileSync,lstatSync,realpathSync} from 'node:fs'
import {resolve,join} from 'node:path'
import {createHash} from 'node:crypto'
import {nativePayloadPlan} from './native-payload-plan.mjs'
import {verifiedCopy} from './verified-copy.mjs'
import {verifyComponentManifest} from './component-integrity.mjs'
const root=resolve(import.meta.dirname,'../../..'),app=join(root,'apps/desktop')
const stage=join(app,'release/native-suite-nori-workspace-gptoss-voice-memory-20261017-r1/NoriSuite')
const suite=join(app,'release/native-desktop-ui-r1/win-unpacked/resources/NoriSuite')
for(const directory of [root,stage,suite])
  if(lstatSync(directory).isSymbolicLink()||realpathSync(directory).toLowerCase()!==directory.toLowerCase())throw Error('Physical payload directories required')
const receiptPath=join(stage,'native-payload-receipt.json'),old=JSON.parse(readFileSync(receiptPath,'utf8'))
const plan=nativePayloadPlan(root),oldFiles=new Map(old.manifest.files.map(file=>[file.path,file]))
if(old.copyVerified!==true||old.schema!==1||oldFiles.size!==old.manifest.files.length)throw Error('Original stage receipt is invalid')
const current=new Map(plan.files.map(file=>[file.path,file]))
for(const file of oldFiles.values())
  if(current.get(file.path)?.bytes!==file.bytes)throw Error('Existing source changed; additive image repair refused: '+file.path)
const added=plan.files.filter(file=>!oldFiles.has(file.path))
if(!added.length||added.some(file=>!file.path.startsWith('integrations/image-generation/runtime/ComfyUI_windows_portable/')))
  throw Error('Expected only newly admitted image runtime code')
if(added.some(file=>file.bytes>8*1024*1024)||added.reduce((n,file)=>n+file.bytes,0)>32*1024*1024)
  throw Error('Image closure repair exceeds small code-only bound')
console.log(JSON.stringify({phase:'planned',files:added.length,bytes:added.reduce((n,file)=>n+file.bytes,0),paths:added.map(file=>file.path)}))
const backup=join(root,'verification/image-closure-stage-receipt-before-20261017-r1.json')
if(existsSync(backup))throw Error('Existing repair evidence preserved')
copyFileSync(receiptPath,backup)
for(const file of added){
  const source=join(root,file.path),sha256=createHash('sha256').update(readFileSync(source)).digest('hex')
  for(const destination of [join(stage,file.path),join(suite,file.path)]){
    if(existsSync(destination))throw Error('Unexpected destination already exists: '+file.path)
    verifiedCopy(source,destination,sha256)
  }
  oldFiles.set(file.path,{path:file.path,bytes:file.bytes,sha256})
}
const manifest={...old.manifest,files:[...oldFiles.values()].sort((a,b)=>a.path.localeCompare(b.path))}
const updated={...old,...plan,manifest,copied:plan.files.length,copyVerified:false,
  incrementalImageClosureRepair:true,priorReceiptBackup:backup}
// copyVerified is restored only by the complete source/stage/package check.
const pending=join(root,'verification/image-closure-pending-receipt-20261017-r1.json')
writeFileSync(pending,JSON.stringify(updated,null,2)+'\n',{flag:'wx'})
console.log(JSON.stringify({phase:'code-copied',addedFiles:added.length,pendingReceipt:pending,fullVerificationRequired:true}))
for(const [label,directory] of [['source',root],['stage',stage]]){
  verifyComponentManifest(directory,manifest,plan.files.map(file=>file.path),{
    onFile:({verifiedFiles})=>{if(verifiedFiles%5000===0)console.log(JSON.stringify({phase:'verifying-'+label,files:verifiedFiles}))},
  })
}
updated.copyVerified=true
const replacement=receiptPath+'.image-repair.tmp'
writeFileSync(replacement,JSON.stringify(updated,null,2)+'\n',{flag:'wx'})
renameSync(replacement,receiptPath)
console.log(JSON.stringify({phase:'image-closure-verified',addedFiles:added.length,sourceMatches:true,stageMatches:true}))
