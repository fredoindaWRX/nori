import {createHash} from 'node:crypto'
import {closeSync,copyFileSync,existsSync,lstatSync,linkSync,mkdirSync,openSync,readSync,realpathSync} from 'node:fs'
import {dirname,isAbsolute,relative,resolve,sep} from 'node:path'

// All operations here are synchronous; reuse one bounded scratch buffer rather
// than allocating megabytes for every file in a large suite stage.
const digestBuffer=Buffer.allocUnsafe(1024*1024)
function digest(path){
  const hash=createHash('sha256'),buffer=digestBuffer
  const fd=openSync(path,'r')
  try{let bytes;while((bytes=readSync(fd,buffer,0,buffer.length,null))>0)hash.update(buffer.subarray(0,bytes))}
  finally{closeSync(fd)}
  return hash.digest('hex')
}

export function verifiedCopy(source,destination,expectedDigest){
  if(!lstatSync(source).isFile())throw new Error(`Not a regular source file: ${source}`)
  const expected=digest(source)
  if(expectedDigest!==undefined){
    if(!/^[a-f0-9]{64}$/i.test(expectedDigest))throw new Error('Invalid expected SHA-256 digest')
    if(expected!==expectedDigest.toLowerCase())throw new Error(`Source file failed SHA-256 verification: ${source}`)
  }
  if(existsSync(destination)){
    if(!lstatSync(destination).isFile())throw new Error(`Not a regular destination file: ${destination}`)
    if(digest(destination)===expected)return 'reused'
  }
  mkdirSync(dirname(destination),{recursive:true})
  copyFileSync(source,destination)
  if(digest(destination)!==expected)throw new Error(`Copied file failed SHA-256 verification: ${destination}`)
  return 'copied'
}

// Keep large immutable model bytes self-contained without allocating a second
// copy. The package verifier still hashes the linked regular file as usual.
function ensureSafeHardlinkParent(destination,allowedRoot){
  const root=resolve(allowedRoot),target=resolve(destination),parent=dirname(target)
  const delta=relative(root,target)
  if(!delta||delta.startsWith('..'+sep)||isAbsolute(delta))throw new Error('Hard-link destination escapes its allowed root')
  if(!lstatSync(root).isDirectory()||lstatSync(root).isSymbolicLink()||resolve(realpathSync(root))!==root)
    throw new Error('Hard-link allowed root is linked or not a regular directory')
  const parentDelta=relative(root,parent)
  let current=root
  if(parentDelta){
    for(const segment of parentDelta.split(sep)){
      current=resolve(current,segment)
      if(!existsSync(current))mkdirSync(current)
      const info=lstatSync(current)
      if(!info.isDirectory()||info.isSymbolicLink()||resolve(realpathSync(current))!==current)
        throw new Error('Hard-link destination parent is linked or not a directory')
    }
  }
}

export function verifiedHardlink(source,destination,expectedDigest,allowedRoot){
  if(typeof allowedRoot!=='string'||!allowedRoot)throw new Error('Hard-link destination root is required')
  if(!lstatSync(source).isFile())throw new Error(`Not a regular source file: ${source}`)
  const expected=digest(source)
  if(expectedDigest!==undefined){
    if(!/^[a-f0-9]{64}$/i.test(expectedDigest))throw new Error('Invalid expected SHA-256 digest')
    if(expected!==expectedDigest.toLowerCase())throw new Error(`Source file failed SHA-256 verification: ${source}`)
  }
  if(existsSync(destination))throw new Error(`Hard-link destination already exists: ${destination}`)
  ensureSafeHardlinkParent(destination,allowedRoot)
  linkSync(source,destination)
  if(!lstatSync(destination).isFile()||digest(destination)!==expected){
    throw new Error(`Hard-linked model failed SHA-256 verification: ${destination}`)
  }
  return {status:'linked',sha256:expected}
}
