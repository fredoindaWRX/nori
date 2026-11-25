// Isolated actual native-stack diagnostic; not a desktop/VM release qualification.
import {createRequire} from 'node:module'
import {createReadStream,readFileSync,writeFileSync} from 'node:fs'
import {createHash} from 'node:crypto'
import {join,resolve} from 'node:path'
import {fileURLToPath} from 'node:url'
import os from 'node:os'
import {nativePayloadPlan} from './native-payload-plan.mjs'
import {verifiedCopy} from './verified-copy.mjs'
const require=createRequire(import.meta.url)
const {scanHardware}=require('../desktop/model-hardware-selection.cjs')
const root=resolve(fileURLToPath(new URL('../../..',import.meta.url)))
const stamp=new Date().toISOString().replace(/\D/g,'')
const stage=join(root,'apps/desktop/release',`mini validation ${stamp}`,'NoriSuite')
const receiptPath=join(root,'verification',`nori-mini-auto-selection-${stamp}.json`)
const GIB=2**30
async function digest(path){const h=createHash('sha256');for await(const chunk of createReadStream(path))h.update(chunk);return h.digest('hex')}
const report={schema:'nori.mini-auto-selection-diagnostic.v1',stage,status:'FAIL',
  stagingScope:'native-service-only; not the desktop or full suite',
  virtualMachineTest:'NOT_PERFORMED',desktopGuiTest:'NOT_PERFORMED',fullContextQualified:false,
  baselineAnswers:0,training:'NOT_STARTED',checks:[]}
let service,watchdog,deadline
const abort=new AbortController()
try {
  const hardware=await scanHardware()
  if(hardware.availableRamBytes<8*GIB || !hardware.gpus.some(g=>g.index===0&&g.freeBytes>=6*GIB))
    throw Error('Diagnostic gate requires 8 GiB free RAM and 6 GiB free GPU memory')
  const sourceConfig=JSON.parse(readFileSync(join(root,'runtime/norllama/config.json'),'utf8'))
  if(sourceConfig.model_id!=='llama3.2-3b-instruct')throw Error('Unexpected model; no inference started')
  const sourceNames=['runtime/norllama/config.json',sourceConfig.engine_binary,sourceConfig.model_path]
  const sourceHashes={}
  for(const name of sourceNames)sourceHashes[name]=await digest(join(root,name))
  if(sourceHashes[sourceConfig.model_path]!=='dde5aa3fc5ffc17176b5e8bdc82f587b24b2678c6c66101bf7da77af9f7ccdff')
    throw Error('Unexpected model bytes')
  console.log('Copying a fresh native-service payload to an isolated path containing spaces')
  // The full suite contains actively edited roadmap metadata. This diagnostic
  // validates the serving closure only; full-suite release checks remain separate.
  const files=nativePayloadPlan(root).files.filter(file=>
    file.path.startsWith('python/Python311/') || file.path.startsWith('runtime/norllama/') ||
    [sourceConfig.engine_binary,sourceConfig.model_path,'engine/norama/norama-tokenizer.exe',
      'apps/desktop/desktop/native-service.cjs','apps/desktop/desktop/model-hardware-selection.cjs',
      'apps/desktop/desktop/portable-model-selection.cjs'].includes(file.path))
  const manifest=[]
  for(const file of files){
    const hash=await digest(join(root,file.path))
    verifiedCopy(join(root,file.path),join(stage,file.path),hash)
    manifest.push({...file,sha256:hash})
  }
  for(const file of manifest)if(await digest(join(root,file.path))!==file.sha256)throw Error('Native serving source changed during staging')
  report.stagedBytes=files.reduce((sum,file)=>sum+file.bytes,0);report.stagedFiles=files.length
  const configName='runtime/norllama/mini-diagnostic-config.json'
  writeFileSync(join(stage,configName),JSON.stringify(sourceConfig,null,2)+'\n',{flag:'wx'})
  const hashes={}
  for(const name of [configName,sourceConfig.engine_binary,sourceConfig.model_path,'runtime/norllama/norllama.py','python/Python311/python.exe'])hashes[name]=await digest(join(stage,name))
  // This profile is restricted to a short diagnostic on the observed GPU family.
  // It must not be promoted to a broad laptop compatibility qualification.
  const profile={id:sourceConfig.model_id,configPath:configName,backend:'norama-cuda',platform:'win32',arch:'x64',
    bundled:true,qualified:true,priority:1,minimumTotalRamBytes:16*GIB,minimumAvailableRamBytes:8*GIB,
    weightBytes:2*GIB,kvCacheBytes:GIB,workspaceBytes:2*GIB,safetyMarginBytes:GIB,
    computeCapabilities:['8.9'],minimumDriverVersion:hardware.gpus.find(g=>g.index===0).driverVersion,
    artifactSha256:hashes,qualificationScope:'short-diagnostic-only'}
  const missing={...profile,id:'not-bundled',configPath:'runtime/norllama/missing.json',priority:100}
  writeFileSync(join(stage,'runtime/norllama/mini-model-catalog.json'),JSON.stringify({schema:1,models:[missing,profile]},null,2)+'\n',{flag:'wx'})
  const {startNativeService:stagedStart}=require(join(stage,'apps/desktop/desktop/native-service.cjs'))
  const environment={NORI_MINI_AUTO_MODEL:'1'}
  for(const [name,host] of [['CPU-only',{...hardware,gpus:[]}],['low-RAM',{...hardware,availableRamBytes:GIB}],
    ['low-VRAM',{...hardware,gpus:hardware.gpus.map(g=>({...g,freeBytes:GIB}))}]]){
    let spawned=false,refused=false
    try {await stagedStart({root:stage,environment,scanHardware:async()=>host,
      spawnChild:()=>{spawned=true;throw Error('Incompatible host spawned a process')}})}
    catch(error){if(error.code!=='NORI_NO_COMPATIBLE_MODEL')throw error;refused=true}
    if(!refused||spawned)throw Error(`${name} was not refused before spawning`)
    report.checks.push({name,mode:'simulated-hardware-real-selection',passed:true,noProcessSpawned:true})
  }
  report.minimumAvailableRamBytes=os.freemem()
  watchdog=setInterval(()=>{report.minimumAvailableRamBytes=Math.min(report.minimumAvailableRamBytes,os.freemem());
    if(report.minimumAvailableRamBytes<4*GIB)abort.abort()},100)
  deadline=setTimeout(()=>abort.abort(),120000)
  console.log('Starting the real staged native runtime through automatic selection')
  const start=performance.now()
  service=await stagedStart({root:stage,environment,signal:abort.signal})
  report.startupSeconds=(performance.now()-start)/1000
  report.selected=service.status.automaticModelSelection.selected
  report.rows=[]
  const history=[]
  for(const prompt of ['Reply with one short greeting.','Remember that my demonstration color is teal. Reply briefly.',
    'What demonstration color did I ask you to remember? Reply briefly.']){
    history.push({role:'user',content:prompt})
    const begin=performance.now()
    const response=await fetch(service.environment.NORI_RUNTIME_URL+'/v1/chat',{method:'POST',
      headers:{Authorization:'Bearer '+service.environment.NORI_RUNTIME_API_KEY,'content-type':'application/json'},signal:abort.signal,
      body:JSON.stringify({model_id:sourceConfig.model_id,messages:history,max_tokens:32,stream:false})})
    const result=await response.json()
    if(!response.ok||typeof result.text!=='string'||!result.text.trim())throw Error('Real staged chat failed')
    report.rows.push({seconds:(performance.now()-begin)/1000,text:result.text,metrics:result.metrics})
    history.push({role:'assistant',content:result.text})
  }
  if(!/teal/i.test(report.rows[2].text))throw Error('Follow-up did not retain the demonstration color')
  await service.stop();if(service.child.exitCode!==0)throw Error('First owned runtime did not stop cleanly')
  report.checks.push({name:'real-native-chat-and-follow-up',passed:true,ownedRuntimeClosed:true})
  console.log('Checking a clean relaunch through automatic selection')
  service=await stagedStart({root:stage,environment,signal:abort.signal})
  await service.stop();if(service.child.exitCode!==0)throw Error('Relaunched owned runtime did not stop cleanly')
  report.checks.push({name:'real-native-relaunch',passed:true,ownedRuntimeClosed:true})
  for(const name of sourceNames)if(await digest(join(root,name))!==sourceHashes[name])throw Error('Source artifact changed')
  report.sourceArtifactsUnchanged=true;report.sourceHashes=sourceHashes
  report.status='PASS_SHORT_NATIVE_SELECTION_DIAGNOSTIC'
}catch(error){report.error=error.message;process.exitCode=1}
finally{
  clearInterval(watchdog);clearTimeout(deadline)
  if(service && service.child.exitCode===null){try{await service.stop()}catch(error){report.cleanupError=error.message;process.exitCode=1}}
  writeFileSync(receiptPath,JSON.stringify(report,null,2)+'\n',{flag:'wx'})
  console.log(JSON.stringify({receipt:receiptPath,status:report.status,error:report.error,stage}))
}
