import assert from 'node:assert/strict'
import {createRequire,registerHooks} from 'node:module'
import {spawn} from 'node:child_process'
import {existsSync,mkdirSync,readFileSync,writeFileSync,readdirSync} from 'node:fs'
import {createHash} from 'node:crypto'
import {pathToFileURL} from 'node:url'
import {setTimeout as delay} from 'node:timers/promises'
import {encodeNeuraleseImageIntent} from '../bridge/neuralese-image-intent.mjs'
const require=createRequire(import.meta.url),asar=require('@electron/asar')
const {assertPortAvailable}=require('../desktop/local-model-port.cjs')
const {startAutomaticTextService}=require('../desktop/automatic-text-service.cjs')
const {createModelCapacityCheck}=require('../desktop/model-resource-fit.cjs')
const {startVideoCapableModelService}=require('../desktop/video-capable-model.cjs')
const {releaseVideoRuntime}=require('../desktop/video-runtime-cleanup.cjs')
const {startGptOssService}=require('C:/Nori/.work/model-team-integration/patch/gpt-oss-service.cjs')
const videoMode=process.argv.includes('--video')
const stem=(videoMode?'video-model-team-live':'image-model-team-live')+(process.argv.includes('--retry')?'-r2':'')
const root='C:/Nori/.work/'+stem,report='C:/Nori/.work/reports/'+stem+'.json'
assert.ok(!existsSync(root)&&!existsSync(report),'Existing evidence preserved')
await assertPortAvailable(18192)
const suite='C:/Program Files/Nori/resources/NoriSuite'
const portable=suite+'/integrations/image-generation/runtime/ComfyUI_windows_portable'
const folders=Object.fromEntries(['input','output','temp','user'].map(key=>[key,root+(videoMode&&key==='output'?'/image-runtime/output':'/'+key)]))
for(const directory of Object.values(folders))mkdirSync(directory,{recursive:true})
const archive='C:/Program Files/Nori/resources/app.asar'
const module={exports:{}}
new Function('module','exports',asar.extractFile(archive,'desktop/comfy-startup.cjs').toString())(module,module.exports)
const args=module.exports.comfyLaunchArgs({inputDirectory:folders.input,outputDirectory:folders.output,tempDirectory:folders.temp,userDirectory:folders.user,port:18192})
const child=spawn(portable+'/python_embeded/python.exe',args,{cwd:portable+'/ComfyUI',windowsHide:true,stdio:['ignore','ignore','pipe'],env:{...process.env,PYTHONDONTWRITEBYTECODE:'1',HF_HUB_OFFLINE:'1',TRANSFORMERS_OFFLINE:'1'}})
let stderr='',spawnError,owner
child.stderr.on('data',bytes=>{stderr=(stderr+bytes.toString()).slice(-10000)})
const exited=new Promise(resolve=>{child.once('exit',resolve);child.once('error',error=>{spawnError=error;resolve()})})
const evidence={scope:'real source model ownership plus installed-based image provider; not installed desktop acceptance',installedAppUpdated:false,microphoneUsed:false,passed:false}
const began=performance.now()
try{
 const readyDeadline=Date.now()+90000
 while(Date.now()<readyDeadline){
  if(spawnError)throw spawnError
  if(child.exitCode!==null)throw Error('Owned image runtime exited')
  try{if((await fetch('http://127.0.0.1:18192/system_stats',{signal:AbortSignal.timeout(750)})).ok){evidence.runtimeReady=true;break}}catch{}
  await delay(250)
 }
 assert.equal(evidence.runtimeReady,true,'Image runtime readiness')
 owner=await startVideoCapableModelService({}, {startService:()=>startAutomaticTextService({port:0,canLoad:createModelCapacityCheck(),startModel:({profile,contextTokens,signal})=>startGptOssService({root:suite,modelProfile:profile,contextTokens,signal})}),cleanupVideo:()=>releaseVideoRuntime('http://127.0.0.1:18192',{requiredFreeVramBytes:8192*1024**2,isOwnedRuntimeStopped:()=>child.exitCode!==null})})
 const endpoint=owner.endpoint
 Object.assign(process.env,{NORI_IMAGE_API:'http://127.0.0.1:18192',NORI_COMFY_URL:'http://127.0.0.1:18192',NORI_COMFY_RUNTIME_MANAGED:'1',NORI_VIDEO_LEASE_URL:owner.environment.NORI_VIDEO_LEASE_URL,NORI_VIDEO_LEASE_TOKEN:owner.environment.NORI_VIDEO_LEASE_TOKEN,NORI_SUITE_ROOT:suite,NORI_APP_DATA_ROOT:root,NORI_VIDEO_OUTPUT_ROOT:folders.output})
 if(videoMode){
  const {encodeNeuraleseVideoIntent}=await import('../bridge/neuralese-video-intent.mjs')
  const {withLocalVideoModelLease}=await import('../bridge/video-model-lease.mjs')
  const {generateLocalVideo}=await import(pathToFileURL(suite+'/apps/desktop/bridge/local-video.mjs').href)
  const frame=encodeNeuraleseVideoIntent('A blue rally car with gold wheels slowly rolling through a Japanese neon street at night, cyan and magenta reflections on wet asphalt, cinematic low camera angle.',{durationSeconds:5})
  const result=await withLocalVideoModelLease(()=>generateLocalVideo(frame,{timeoutMs:600000,onProgress:value=>console.log(JSON.stringify({phase:'video-progress',...value}))}),{mediaKind:'video'})
  assert.equal(result.durationSeconds,5);assert.equal(result.frameCount,80);assert.equal(result.shots,3)
  evidence.video=result
  assert.equal(owner.videoModelState,'ready');assert.equal(owner.endpoint,endpoint)
 }else{
 const patch='C:/Nori/.work/model-team-integration/patch/local-image.mjs',patchURL=pathToFileURL(patch).href
 const dependencies={'./local-policy.mjs':suite+'/apps/desktop/bridge/local-policy.mjs','./neuralese-image-intent.mjs':suite+'/apps/desktop/bridge/neuralese-image-intent.mjs','./video-model-lease.mjs':'C:/Nori/apps/desktop/bridge/video-model-lease.mjs'}
 const hook=registerHooks({resolve(specifier,context,next){return next(context.parentURL===patchURL&&dependencies[specifier]?pathToFileURL(dependencies[specifier]).href:specifier,context)}})
 let generateImage
 try{({generateImage}=await import(patchURL))}finally{hook.deregister()}
 const frame=encodeNeuraleseImageIntent('Cinematic detailed blue rally sedan with gold wheels on a Japanese neon street at night, magenta and cyan lighting, wet asphalt reflections, low camera angle, realistic automotive photography. No social-media interface.',{width:768,height:1280})
 const image=await generateImage(frame,{timeoutMs:180000})
 assert.equal(image.mimeType,'image/png');assert.equal(owner.videoModelState,'ready');assert.equal(owner.endpoint,endpoint)
 const files=readdirSync(folders.output).filter(name=>name.endsWith('.png'));assert.equal(files.length,1)
 const file=folders.output+'/'+files[0],bytes=readFileSync(file)
 assert.ok(bytes.equals(Buffer.from(image.data,'base64')))
 evidence.image={path:file,sha256:createHash('sha256').update(bytes).digest('hex'),width:bytes.readUInt32BE(16),height:bytes.readUInt32BE(20)}
 assert.equal(evidence.image.width,768);assert.equal(evidence.image.height,1280)
 }
 const response=await fetch(endpoint+'/v1/chat/completions',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({model:'nori-auto',messages:[{role:'user',content:'Reply exactly NORI_MEDIA_RESTORE_OK.'}],max_tokens:32,temperature:0}),signal:AbortSignal.timeout(90000)})
 const reply=await response.json();assert.equal(response.status,200);assert.equal(reply.choices[0].message.content.trim(),'NORI_MEDIA_RESTORE_OK')
 evidence.chatRestored=true;evidence.sameEndpointPreserved=true;evidence.passed=true
}catch(error){evidence.error=String(error.stack||error);process.exitCode=1}
finally{
 try{await owner?.stop()}catch(error){evidence.stopError=String(error);evidence.passed=false;process.exitCode=1}
 if(child.exitCode===null&&!spawnError)child.kill()
 let timer
 try{await Promise.race([exited,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Owned image runtime did not stop')),10000)})]);evidence.ownedProcessesStopped=true}finally{clearTimeout(timer)}
 evidence.elapsedSeconds=Number(((performance.now()-began)/1000).toFixed(3));evidence.stderrTail=stderr
 writeFileSync(report,JSON.stringify(evidence,null,2),{flag:'wx'})
 console.log(JSON.stringify({...evidence,stderrTail:undefined}))
}
