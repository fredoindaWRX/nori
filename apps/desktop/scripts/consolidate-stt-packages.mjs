/** Recover dependency files only; no venv, downloads, installs or USB writes. */
import {existsSync,lstatSync,readdirSync,mkdirSync,writeFileSync} from 'node:fs'
import {join,resolve} from 'node:path'
import {fileURLToPath} from 'node:url'
import {verifiedCopy} from './verified-copy.mjs'
const root=fileURLToPath(new URL('../../../',import.meta.url))
const source='F:/release/suite-payload/NoriSuite/apps/NoriV2/.venv-stt/Lib/site-packages'
const target=join(root,'runtime/stt/packages')
if(process.argv.length!==3||process.argv[2]!=='--copy')throw new Error('Explicit --copy required')
if(existsSync(target))throw new Error('Refusing to overwrite existing STT packages')
const files=[]
function scan(directory,prefix=''){
  for(const entry of readdirSync(directory,{withFileTypes:true})){
    if(entry.name==='__pycache__'||entry.name.endsWith('.pyc'))continue
    const from=join(directory,entry.name),name=join(prefix,entry.name)
    const info=lstatSync(from)
    if(info.isSymbolicLink())throw new Error('Linked recovery files are not supported')
    if(info.isDirectory())scan(from,name)
    else if(info.isFile())files.push({from,name,bytes:info.size})
  }
}
scan(source)
for(const required of ['faster_whisper/__init__.py','ctranslate2/__init__.py','av/__init__.py'])
  if(!files.some(file=>file.name.replaceAll('\\','/')===required))throw new Error('Incomplete STT recovery source')
mkdirSync(target,{recursive:true})
for(const file of files)verifiedCopy(file.from,join(target,file.name))
const receipt={source,target:resolve(target),files:files.length,bytes:files.reduce((sum,file)=>sum+file.bytes,0),
  copiedFilesSha256Verified:true,usbModified:false,modelCopied:false,runtimeVerified:false}
writeFileSync(join(root,'runtime/stt/consolidation-receipt.json'),JSON.stringify(receipt,null,2)+'\n',{flag:'wx'})
console.log(JSON.stringify(receipt))
