import {join,resolve} from 'node:path'
import {lstatSync,readFileSync} from 'node:fs'
import {pathToFileURL} from 'node:url'
import {verifyComponentManifest} from './component-integrity.mjs'
import {desktopArtifactPaths} from './desktop-artifacts.mjs'
import {nativeDistributionPaths} from './native-distribution-inventory.mjs'

// Read-only backup verification: no development tree, installer, or model
// service is required. A matching receipt detects corruption, not tampering
// by someone able to replace both the files and their unsigned receipt.
export function verifyPortableNative(desktopRoot,receipt,{progress=()=>{},profileHashes=false}={}) {
  if(typeof progress!=='function'||typeof profileHashes!=='boolean')throw Error('Invalid portable diagnostic options')
  if(!receipt||receipt.schema!==1||receipt.packagedPayloadMatches!==true||!receipt.nativeManifest)
    throw Error('Portable native receipt is missing or incomplete')
  progress('desktop-inventory')
  const desktopPaths=desktopArtifactPaths(desktopRoot)
  progress('desktop-hashes')
  verifyComponentManifest(desktopRoot,receipt.desktopManifest,desktopPaths)
  const suite=join(desktopRoot,'resources/NoriSuite')
  progress('native-inventory')
  const nativePaths=nativeDistributionPaths(suite)
  progress('native-hashes')
  const groups=new Map()
  const onFile=profileHashes?record=>{
    const parts=record.path.split('/')
    let group=parts.length>=3?parts.slice(0,2).join('/'):
      parts.length===2?`${parts[0]}/<files>`:'<root>'
    if(!groups.has(group)&&groups.size>=32)group='other'
    const totals=groups.get(group)||{group,files:0,bytes:0,elapsedMs:0}
    totals.files++;totals.bytes+=record.bytes;totals.elapsedMs+=record.elapsedMs
    groups.set(group,totals)
    if(record.elapsedMs>=250)progress('native-slow-file',record)
  }:undefined
  verifyComponentManifest(suite,receipt.nativeManifest,nativePaths,{onFile})
  if(profileHashes)progress('native-hash-groups',{groups:[...groups.values()].sort((a,b)=>b.elapsedMs-a.elapsedMs)})
  progress('size-check')
  const totalBytes=[...receipt.desktopManifest.files,...receipt.nativeManifest.files]
    .reduce((sum,file)=>sum+file.bytes,0)
  if(!Number.isSafeInteger(totalBytes)||totalBytes!==receipt.totalBytes||totalBytes>=128_000_000_000)
    throw Error('Portable native size receipt is inconsistent')
  return {desktopIntegrityVerified:true,payloadIntegrityVerified:true,totalBytes,
    sourceTreeRequired:false,publisherAuthenticated:false,installedSuiteVerified:false,releaseVerified:false}
}

if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href) {
  // Electron's fs archive virtualization must not replace raw distribution
  // bytes with the contents of app.asar during an integrity check.
  if(process.versions.electron)process.noAsar=true
  try {
    const args=process.argv.slice(2)
    if(args.length!==2)throw Error('Usage: verify-portable-native.mjs <win-unpacked directory> <receipt.json>')
    const receiptPath=resolve(args[1]),info=lstatSync(receiptPath)
    if(info.isSymbolicLink()||!info.isFile()||info.size>32*1024*1024)
      throw Error('Unsafe or oversized portable receipt')
    const receipt=JSON.parse(readFileSync(receiptPath,'utf8'))
    const started=Date.now()
    const progress=process.env.NORI_VERIFY_PROGRESS==='1'?
      (phase,details)=>console.error(JSON.stringify({phase,elapsedMs:Date.now()-started,...(details?{file:details}: {})})):()=>{}
    console.log(JSON.stringify(verifyPortableNative(resolve(args[0]),receipt,{progress,profileHashes:process.env.NORI_VERIFY_PROGRESS==='1'})))
  }catch(error) {
    console.error(JSON.stringify({verified:false,error:error.message}))
    process.exitCode=1
  }
}
