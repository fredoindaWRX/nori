// Read-only closure for explicitly requested portable model catalogs.
import {readFileSync,realpathSync,statSync,openSync,readSync,closeSync} from 'node:fs'
import {createHash} from 'node:crypto'
import {resolve,relative,isAbsolute} from 'node:path'
import portableSelection from '../desktop/portable-model-selection.cjs'
export function portableModelPayload(root,catalogName){
  root=realpathSync(root)
  const read=name=>{
    if(typeof name!=='string' || !name || isAbsolute(name) || name.split(/[\\/]/).includes('..'))throw Error('Unsafe portable model payload path')
    const path=realpathSync(resolve(root,name)),delta=relative(root,path)
    if(delta.startsWith('..') || isAbsolute(delta) || !statSync(path).isFile())throw Error('Portable model payload escapes package')
    return path
  }
  const json=name=>{
    const path=read(name)
    if(statSync(path).size>1024*1024)throw Error('Portable model metadata exceeds size limit')
    return JSON.parse(readFileSync(path,'utf8').replace(/^\uFEFF/,''))
  }
  const catalog=json(catalogName)
  const digest=path=>{
    const handle=openSync(path,'r'),hash=createHash('sha256'),buffer=Buffer.alloc(1024*1024)
    try{let bytes;while((bytes=readSync(handle,buffer,0,buffer.length,null))>0)hash.update(buffer.subarray(0,bytes))}
    finally{closeSync(handle)}
    return hash.digest('hex')
  }
  if(catalog.schema!==1 || !Array.isArray(catalog.models) || catalog.models.length>32 ||
     new Set(catalog.models.map(p=>p.id)).size!==catalog.models.length)throw Error('Invalid portable model catalog')
  const files=new Set([catalogName]),models=[]
  for(const profile of catalog.models){
    if(profile.qualified!==true || profile.bundled!==true)continue
    const config=json(profile.configPath)
    const backend=config.compute_backend ?? 'cuda'
    if(config.model_id!==profile.id || !['norama-cpu','norama-cuda'].includes(profile.backend) ||
       profile.backend!==`norama-${backend}`)throw Error('Portable model configuration identity mismatch')
    const dependencies=profile.runtimeFiles ?? []
    if(!Array.isArray(dependencies) || dependencies.length>32)throw Error('Invalid portable runtime dependencies')
    const closure=[profile.configPath,config.engine_binary,config.model_path,...portableSelection.CORE_RUNTIME_FILES,...dependencies]
    for(const name of closure){
      const path=read(name)
      if(!/^[a-f0-9]{64}$/.test(profile.artifactSha256?.[name] ?? ''))throw Error('Portable model lacks integrity binding')
      if(digest(path)!==profile.artifactSha256[name])throw Error('Portable model artifact differs from catalog')
      files.add(name)
    }
    models.push(profile.id)
  }
  if(!models.length)throw Error('Portable catalog has no qualified bundled models to package')
  return {files:[...files].sort(),models,qualificationVerified:false}
}
