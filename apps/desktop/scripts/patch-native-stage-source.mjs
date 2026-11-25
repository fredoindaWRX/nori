// Apply a bounded source-only delta to the verified stage and unfinished app.
// Large runtime/model files are never copied. Recovery revalidates all bytes.
import {readFileSync,writeFileSync,copyFileSync,renameSync,lstatSync,realpathSync,existsSync} from 'node:fs'
import {resolve,join} from 'node:path'
import {createHash} from 'node:crypto'
import {verifiedCopy} from './verified-copy.mjs'
const root=resolve(import.meta.dirname,'../../..')
const allowed=new Set(['apps/desktop/bridge/image-intent.mjs','apps/desktop/bridge/local-chat.mjs','apps/desktop/bridge/nori-v2-query.mjs'])
const paths=process.argv.slice(2)
if(!paths.length||new Set(paths).size!==paths.length||paths.some(path=>!allowed.has(path)))throw Error('Explicit bounded bridge source required')
const stage=join(root,'apps/desktop/release/native-suite-nori-workspace-gptoss-voice-memory-20261017-r1/NoriSuite')
const suite=join(root,'apps/desktop/release/native-desktop-ui-r1/win-unpacked/resources/NoriSuite')
for(const directory of [root,stage,suite])if(lstatSync(directory).isSymbolicLink()||realpathSync(directory).toLowerCase()!==directory.toLowerCase())throw Error('Physical build directories required')
const receiptPath=join(stage,'native-payload-receipt.json'),receipt=JSON.parse(readFileSync(receiptPath,'utf8'))
if(receipt.copyVerified!==true)throw Error('Prior stage is not verified')
if(existsSync(join(suite,'../../../native-desktop-receipt.json')))throw Error('Completed candidate cannot be patched')
const backup=join(root,'verification',`stage-receipt-before-source-patch-${Date.now()}.json`)
copyFileSync(receiptPath,backup)
for(const path of paths){
  const entry=receipt.manifest.files.find(file=>file.path===path),planned=receipt.files.find(file=>file.path===path)
  const source=join(root,path),content=readFileSync(source)
  if(!entry||!planned||content.length>2*1024*1024)throw Error('Source delta is not an existing bounded component')
  const sha256=createHash('sha256').update(content).digest('hex')
  for(const destination of [join(stage,path),join(suite,path)])verifiedCopy(source,destination,sha256)
  receipt.bytes+=content.length-entry.bytes
  entry.bytes=content.length;entry.sha256=sha256;planned.bytes=content.length
}
const temporary=receiptPath+'.source-patch.tmp'
writeFileSync(temporary,JSON.stringify(receipt,null,2)+'\n',{flag:'wx'})
renameSync(temporary,receiptPath)
console.log(JSON.stringify({sourcePatchApplied:paths,priorReceiptBackup:backup,fullRecoveryVerificationRequired:true}))
