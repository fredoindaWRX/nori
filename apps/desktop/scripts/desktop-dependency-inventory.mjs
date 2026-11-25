import {createRequire} from 'node:module'
import {createHash} from 'node:crypto'
import {lstatSync,realpathSync,openSync,readSync,closeSync} from 'node:fs'
import {resolve,sep,join,relative,isAbsolute} from 'node:path'
import {pathToFileURL} from 'node:url'
const require=createRequire(import.meta.url)

// Metadata only: never load a shipped dependency or follow archive links.
export function desktopDependencyInventory(archive,{reader=require('@electron/asar')}={}) {
  const normalized=value=>process.platform==='win32'?value.toLowerCase():value
  const actual=realpathSync(archive),info=lstatSync(archive)
  if(!info.isFile()||info.isSymbolicLink()||normalized(actual)!==normalized(resolve(archive)))
    throw Error('Unsafe desktop archive')
  const paths=reader.listPackage(actual)
  if(paths.length>100000)throw Error('Desktop archive inventory limit')
  const packages=[],refused=[]
  function readUnpacked(path) {
    const root=actual+'.unpacked',target=join(root,path)
    // Check every ancestor before reading metadata outside the archive.
    let cursor=root
    for(const part of ['',...path.split('/')]) {
      if(part)cursor=join(cursor,part)
      const entry=lstatSync(cursor),physical=realpathSync(cursor)
      if(entry.isSymbolicLink()||normalized(physical)!==normalized(cursor))throw Error('Linked unpacked metadata')
      if(cursor!==target&&!entry.isDirectory())throw Error('Invalid unpacked metadata ancestor')
    }
    const delta=relative(root,realpathSync(target)),entry=lstatSync(target)
    if(delta.startsWith('..')||isAbsolute(delta)||!entry.isFile())throw Error('Unsafe unpacked metadata')
    const buffer=Buffer.alloc(1024*1024+1),fd=openSync(target,'r')
    let length=0
    try {
      let size
      while(length<buffer.length&&(size=readSync(fd,buffer,length,buffer.length-length,null))>0)length+=size
    } finally {closeSync(fd)}
    if(length>1024*1024)throw Error('Oversized unpacked metadata')
    return buffer.subarray(0,length)
  }
  for(const raw of paths) {
    const path=raw.replaceAll('\\','/').replace(/^\//,'')
    if(!/(?:^|\/)node_modules\/(?:@[^/]+\/)?[^/]+\/package\.json$/.test(path))continue
    if(path.split('/').some(part=>!part||part==='.'||part==='..')||/[:\x00-\x1f]/.test(path))
      throw Error('Unsafe archive metadata path')
    const archivePath=path.split('/').join(sep)
    const stat=reader.statFile(actual,archivePath,false)
    if(stat.link||!Number.isSafeInteger(stat.size)||stat.size<0||stat.size>1024*1024) {
      refused.push({path,reason:'unsafe-or-oversized-metadata'})
      continue
    }
    const bytes=stat.unpacked?readUnpacked(path):reader.extractFile(actual,archivePath,false)
    if(bytes.length!==stat.size)throw Error('Archive metadata changed or inconsistent')
    const metadata=JSON.parse(new TextDecoder('utf8',{fatal:true}).decode(bytes))
    if(typeof metadata.name!=='string'||!metadata.name||typeof metadata.version!=='string'||!metadata.version)
      throw Error('Archive package identity absent')
    packages.push({path,storage:stat.unpacked?'unpacked':'archive',name:metadata.name,version:metadata.version,
      license:typeof metadata.license==='string'?metadata.license:null,
      metadataSha256:createHash('sha256').update(bytes).digest('hex'),licenseReviewRequired:true})
  }
  return {schema:1,scope:'desktop-asar-package-metadata',packages,refused,
    dependencyCodeExecuted:false,completeDependencyInventory:false,
    redistributionApproved:false,releaseVerified:false}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href) {
  if(process.argv.length!==3)throw Error('Expected one explicit app.asar path')
  console.log(JSON.stringify(desktopDependencyInventory(process.argv[2]),null,2))
}
