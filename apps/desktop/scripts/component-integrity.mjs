// Integrity is corruption detection, not publisher authentication or qualification.
import {createHash} from 'node:crypto'
import {lstatSync,realpathSync,openSync,readSync,closeSync} from 'node:fs'
import {resolve,relative,isAbsolute,sep} from 'node:path'

function containedFile(root,path){
  if(typeof path!=='string' || !path || path.includes('\\') || isAbsolute(path) ||
     path.split('/').some(part=>!part || part==='.' || part==='..' || /[. ]$/.test(part) ||
       /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part)) || /[:\x00-\x1f<>"|?*]/.test(path))
    throw new Error('Invalid component path')
  const target=resolve(root,path),delta=relative(root,realpathSync(target))
  if(delta==='..' || delta.startsWith('..'+sep) || isAbsolute(delta) || lstatSync(target).isSymbolicLink() ||
     !lstatSync(target).isFile())throw new Error('Component escapes root or is not a regular file')
  return target
}

function measure(path,buffer){
  const fd=openSync(path,'r'),hash=createHash('sha256')
  let bytes=0
  try{let length;while((length=readSync(fd,buffer,0,buffer.length,null))>0){bytes+=length;hash.update(buffer.subarray(0,length))}}
  finally{closeSync(fd)}
  return {bytes,sha256:hash.digest('hex')}
}

export function buildComponentManifest(root,paths){
  root=realpathSync(root)
  if(!Array.isArray(paths) || !paths.length || paths.length>100000 ||
     paths.some(path=>typeof path!=='string') || new Set(paths.map(path=>path.toLowerCase())).size!==paths.length)
    throw new Error('Invalid component file list')
  const buffer=Buffer.allocUnsafe(1024*1024)
  const files=[...paths].sort().map(path=>({path,...measure(containedFile(root,path),buffer)}))
  return {schema_version:1,algorithm:'sha256',files,release_qualified:false}
}

export function verifyComponentManifest(root,manifest,requiredPaths,{onFile}={}){
  if(onFile!==undefined&&typeof onFile!=='function')throw Error('Invalid component progress callback')
  root=realpathSync(root)
  if(!manifest || manifest.schema_version!==1 || manifest.algorithm!=='sha256' ||
     !Array.isArray(manifest.files) || !manifest.files.length || manifest.files.length>100000)
    throw new Error('Invalid component manifest')
  const seen=new Set()
  const buffer=Buffer.allocUnsafe(1024*1024)
  if(requiredPaths!==undefined){
    if(!Array.isArray(requiredPaths) || !requiredPaths.length || requiredPaths.some(path=>typeof path!=='string'))
      throw new Error('Invalid required component file list')
    const required=new Set(requiredPaths.map(path=>path.toLowerCase()))
    if(required.size!==requiredPaths.length || manifest.files.length!==required.size ||
       manifest.files.some(file=>!file || typeof file.path!=='string' || !required.has(file.path.toLowerCase())))
      throw new Error('Manifest does not match required components')
  }
  for(const file of manifest.files){
    if(!file || typeof file.path!=='string' || seen.has(file.path.toLowerCase()) || !Number.isSafeInteger(file.bytes) || file.bytes<0 ||
       typeof file.sha256!=='string' || !/^[a-f0-9]{64}$/.test(file.sha256))throw new Error('Invalid component entry')
    seen.add(file.path.toLowerCase())
    const started=onFile?performance.now():0
    const actual=measure(containedFile(root,file.path),buffer)
    if(actual.bytes!==file.bytes || actual.sha256!==file.sha256)throw new Error(`Component integrity mismatch: ${file.path}`)
    if(onFile)onFile({path:file.path,bytes:actual.bytes,elapsedMs:performance.now()-started,verifiedFiles:seen.size})
  }
  return {verified_files:seen.size,required_set_checked:requiredPaths!==undefined,
          release_qualified:false,publisher_authenticated:false}
}
