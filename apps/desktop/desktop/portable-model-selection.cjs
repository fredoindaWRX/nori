// Portable mode never rewrites the installed configuration or downloads models.
const {readFileSync,realpathSync,statSync,createReadStream,openSync,readSync,closeSync} = require('node:fs')
const {resolve,relative,isAbsolute} = require('node:path')
const {createHash} = require('node:crypto')
const {scanHardware,selectModel} = require('./model-hardware-selection.cjs')
const CORE_RUNTIME_FILES=Object.freeze(['runtime/norllama/norllama.py','python/Python311/python.exe'])

function fileIdentity(path) {
  const info=statSync(path,{bigint:true})
  return [info.dev,info.ino,info.size,info.mtimeNs,info.ctimeNs].join(':')
}
function packageFile(root,name) {
  if (typeof name !== 'string' || !name || isAbsolute(name) || name.split(/[\\/]/).includes('..'))
    throw Error('Portable component must be a relative package path')
  const path=realpathSync(resolve(root,name)),delta=relative(root,path)
  if (delta.startsWith('..') || isAbsolute(delta) || !statSync(path).isFile() || statSync(path).size===0)
    throw Error('Portable component is missing, empty, or outside the package')
  return path
}
function readJson(path) {
  if (statSync(path).size>1024*1024) throw Error('Portable metadata is too large')
  return JSON.parse(readFileSync(path,'utf8').replace(/^\uFEFF/,''))
}
async function digest(path,checkCancellation) {
  const hash=createHash('sha256')
  for await (const chunk of createReadStream(path)) {
    checkCancellation?.()
    hash.update(chunk)
  }
  return hash.digest('hex')
}
function startupSampleDigest(path) {
  const size=statSync(path).size,chunkSize=64*1024,samples=64
  if(!Number.isSafeInteger(size)||size<chunkSize*samples)throw Error('Large portable artifact is too small for sampled startup integrity')
  const hash=createHash('sha256'),header=Buffer.alloc(16),buffer=Buffer.alloc(chunkSize),handle=openSync(path,'r')
  header.writeBigUInt64LE(BigInt(size),0);hash.update(header.subarray(0,8))
  try{
    for(let index=0;index<samples;index++){
      const offset=Math.floor(index*(size-chunkSize)/(samples-1))
      header.writeBigUInt64LE(BigInt(offset),8);hash.update(header.subarray(8,16))
      let at=0
      while(at<chunkSize){const count=readSync(handle,buffer,at,chunkSize-at,offset+at);if(!count)throw Error('Portable artifact truncated during startup sampling');at+=count}
      hash.update(buffer)
    }
  }finally{closeSync(handle)}
  return hash.digest('hex')
}
async function selectPortableModel(root,{scan=scanHardware,signal}={}) {
  root=realpathSync(root)
  const checkCancellation=()=>{if(signal?.aborted) throw Error('Portable model selection cancelled')}
  checkCancellation()
  const catalog=readJson(packageFile(root,'runtime/norllama/mini-model-catalog.json'))
  if (catalog.schema!==1 || !Array.isArray(catalog.models) || catalog.models.length>32 ||
      new Set(catalog.models.map(p=>p.id)).size!==catalog.models.length)
    throw Error('Invalid portable model catalog')
  // A catalog declaration cannot stand in for the files actually on this USB.
  const profiles=catalog.models.map(p=>{
    try {
      const config=readJson(packageFile(root,p.configPath))
      packageFile(root,config.engine_binary);packageFile(root,config.model_path)
      const computeBackend=config.compute_backend ?? 'cuda'
      const backendMatches=(p.backend==='norama-cuda' && computeBackend==='cuda') ||
        (p.backend==='norama-cpu' && computeBackend==='cpu' &&
          (config.cache_precision ?? 'f32')==='f32' && (config.prompt_limit ?? 2048)===2048)
      const cacheBudget=config.cpu_weight_cache_budget ?? 0
      const cpuTiled=config.cpu_tiled ?? false
      const cacheMatches=Number.isInteger(cacheBudget) && [0,2*1024**3,8*1024**3].includes(cacheBudget) &&
        (!cacheBudget || (computeBackend==='cpu' && p.workspaceBytes>=cacheBudget))
      const tiledMatches=typeof cpuTiled==='boolean' &&
        (!cpuTiled || (computeBackend==='cpu' && cacheBudget===0))
      return {...p,bundled:p.bundled===true && config.model_id===p.id && backendMatches && cacheMatches && tiledMatches}
    } catch {return {...p,bundled:false}}
  })
  const hardware=await scan()
  checkCancellation()
  const selection=selectModel(hardware,profiles)
  if (!selection.selected) throw Object.assign(Error(selection.message),{code:'NORI_NO_COMPATIBLE_MODEL',selection})
  const profile=profiles.find(p=>p.id===selection.selected.id)
  // The current launcher/worker has no device-selection argument. Never silently
  // launch device zero after the policy selects a different device.
  if (selection.selected.gpuIndex!==null && selection.selected.gpuIndex!==0)
    throw Error('Portable launcher does not yet support selecting a nonzero GPU')
  const configPath=packageFile(root,profile.configPath),config=readJson(configPath)
  const runtimeFiles=profile.runtimeFiles ?? []
  if (!Array.isArray(runtimeFiles) || runtimeFiles.length>32 ||
      runtimeFiles.some(name=>typeof name!=='string' || !name))
    throw Error('Invalid portable supporting runtime files')
  const paths=[...new Set([profile.configPath,config.engine_binary,config.model_path,...CORE_RUNTIME_FILES,...runtimeFiles])]
  const verifiedFiles=[]
  for (const name of paths) {
    const expected=profile.artifactSha256?.[name]
    if (!/^[a-f0-9]{64}$/.test(expected || '')) throw Error('Portable model lacks artifact integrity bindings')
    const path=packageFile(root,name),sampled=profile.startupSampleSha256?.[name]
    const identity=fileIdentity(path)
    if(statSync(path).size>=256*1024*1024 && /^[a-f0-9]{64}$/.test(sampled || '')){
      if(startupSampleDigest(path)!==sampled)throw Error('Portable model startup sample integrity check failed')
    }
    // Samples can reject quickly, but cannot prove the unsampled bytes intact.
    if (await digest(path,checkCancellation)!==expected) throw Error('Portable model artifact integrity check failed')
    if(fileIdentity(path)!==identity)throw Error('Portable artifact changed during verification')
    verifiedFiles.push({name,path,identity})
    checkCancellation()
  }
  // Hashing a large USB model can take minutes; the initial free-memory sample
  // is no longer sufficient evidence that the selected profile still fits.
  const currentHardware=await scan()
  checkCancellation()
  for(const file of verifiedFiles) {
    if(packageFile(root,file.name)!==file.path || fileIdentity(file.path)!==file.identity)
      throw Error('Portable artifact changed after verification; restart selection')
  }
  const sameDeviceHardware={...currentHardware,
    gpus:currentHardware.gpus.filter(g=>g?.index===selection.selected.gpuIndex)}
  const currentSelection=selectModel(sameDeviceHardware,[profile])
  if(!currentSelection.selected || currentSelection.selected.gpuIndex!==selection.selected.gpuIndex)
    throw Object.assign(Error('Hardware availability changed during artifact verification; rescan before launch'),
      {code:'NORI_NO_COMPATIBLE_MODEL',selection:currentSelection})
  return {configName:profile.configPath,configPath,
    configSha256:profile.artifactSha256[profile.configPath],
    selection:currentSelection,hardware:currentHardware}
}
module.exports={selectPortableModel,startupSampleDigest,CORE_RUNTIME_FILES}
