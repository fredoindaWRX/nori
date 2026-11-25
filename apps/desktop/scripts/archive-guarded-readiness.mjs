import {lstatSync,realpathSync,openSync,fstatSync,readSync,closeSync,linkSync,unlinkSync} from 'node:fs'
import {join,dirname,resolve,basename} from 'node:path'
import {createHash} from 'node:crypto'
const digest=bytes=>createHash('sha256').update(bytes).digest('hex')
function unlinked(directory){
  for(let path=directory;;path=dirname(path)){
    const info=lstatSync(path)
    if(info.isSymbolicLink()||!info.isDirectory()||realpathSync(path)!==resolve(path))
      throw Error('Unlinked guarded readiness path required')
    if(path===dirname(path))break
  }
}
function regular(path){
  const info=lstatSync(path)
  if(!info.isFile()||info.isSymbolicLink()||info.size>65536)throw Error('Invalid bounded guarded readiness file')
  return info
}
const sameFile=(a,b)=>a.dev===b.dev&&a.ino===b.ino&&a.size===b.size
function readBounded(path){
  const before=regular(path),handle=openSync(path,'r')
  try{
    const opened=fstatSync(handle),bytes=Buffer.alloc(65537)
    if(!opened.isFile()||!sameFile(before,opened))throw Error('Guarded readiness identity changed')
    let length=0,read
    do{read=readSync(handle,bytes,length,bytes.length-length,null);length+=read}while(read&&length<bytes.length)
    if(length>65536||length!==opened.size||!sameFile(before,regular(path)))
      throw Error('Guarded readiness exceeded bound or changed')
    return {info:before,bytes:bytes.subarray(0,length)}
  }finally{closeSync(handle)}
}
export function captureGuardedReadiness(source,expected){
  if(basename(source)!=='desktop-readiness.json')throw Error('Exact guarded readiness file required')
  unlinked(dirname(source))
  const captured=readBounded(source)
  if(JSON.stringify(JSON.parse(captured.bytes.toString('utf8')))!==JSON.stringify(expected))
    throw Error('Guarded readiness was replaced after the owned acceptance')
  return digest(captured.bytes)
}
// Called only by the external owner after successful previous exact Job drain,
// with new companion guardians held. No arbitrary stale-output cleanup.
export function archiveGuardedReadiness({source,fixture,sha256}){
  if(basename(source)!=='desktop-readiness.json'||!/^\.native-job-guardian-[\w-]+$/.test(basename(fixture))||
    typeof sha256!=='string'||!/^[a-f0-9]{64}$/.test(sha256))throw Error('Exact captured guarded readiness required')
  unlinked(dirname(source));unlinked(fixture)
  const original=readBounded(source)
  if(digest(original.bytes)!==sha256)throw Error('Prior guarded readiness changed; preserved')
  const destination=join(fixture,'prior-desktop-readiness.json')
  // Exclusive link publication cannot overwrite an existing/foreign archive.
  linkSync(source,destination)
  const archived=readBounded(destination),current=readBounded(source)
  if(!sameFile(original.info,archived.info)||digest(archived.bytes)!==sha256||
    !sameFile(original.info,current.info)||digest(current.bytes)!==sha256)
    throw Error('Guarded readiness identity changed; source preserved')
  unlinkSync(source)
  return Object.freeze({path:destination,sha256})
}
