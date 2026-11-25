import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import {spawn} from 'node:child_process'
import {existsSync,mkdirSync,writeFileSync} from 'node:fs'
import {setTimeout as delay} from 'node:timers/promises'
const require=createRequire(import.meta.url),asar=require('@electron/asar')
const source=asar.extractFile('C:/Program Files/Nori/resources/app.asar','desktop/comfy-startup.cjs').toString()
const module={exports:{}}
new Function('module','exports',source)(module,module.exports)
const root='C:/Nori/.work/comfy-model-team-probe'
const report='C:/Nori/.work/reports/comfy-model-team-probe.json'
assert.ok(!existsSync(root)&&!existsSync(report),'Existing diagnostics preserved')
const {assertPortAvailable}=require('../desktop/local-model-port.cjs');await assertPortAvailable(18191)
const folders=Object.fromEntries(['input','output','temp','user'].map(key=>[key,root+'/'+key]))
for(const path of Object.values(folders))mkdirSync(path,{recursive:true})
const portable='C:/Program Files/Nori/resources/NoriSuite/integrations/image-generation/runtime/ComfyUI_windows_portable'
const args=module.exports.comfyLaunchArgs({inputDirectory:folders.input,outputDirectory:folders.output,
 tempDirectory:folders.temp,userDirectory:folders.user,port:18191}).map(arg=>arg==='--lowvram'?'--cpu':arg)
const child=spawn(portable+'/python_embeded/python.exe',args,{cwd:portable+'/ComfyUI',windowsHide:true,
 stdio:['ignore','ignore','pipe'],env:{...process.env,PYTHONDONTWRITEBYTECODE:'1',HF_HUB_OFFLINE:'1',TRANSFORMERS_OFFLINE:'1'}})
let stderr='',spawnError
child.stderr.on('data',bytes=>{stderr=(stderr+bytes.toString()).slice(-7000)})
const exited=new Promise(resolve=>{child.once('exit',code=>resolve(code));child.once('error',error=>{spawnError=error;resolve(null)})})
const began=performance.now(),result={cpuOnly:true,modelGenerationTested:false,gpuModelLoaded:false,microphoneUsed:false}
try{
 while(performance.now()-began<90000){
  if(spawnError||child.exitCode!==null)break
  try{
   const response=await fetch('http://127.0.0.1:18191/system_stats',{signal:AbortSignal.timeout(750)})
   if(response.ok){
    result.ready=true
    const nodes=await(await fetch('http://127.0.0.1:18191/object_info/UNETLoader',{signal:AbortSignal.timeout(5000)})).json()
    result.availableDiffusionModels=nodes.UNETLoader?.input?.required?.unet_name?.[0]??[]
    break
   }
  }catch{}
  await delay(200)
 }
 result.ready??=false;result.elapsedSeconds=Number(((performance.now()-began)/1000).toFixed(3))
 result.exitCode=child.exitCode;result.stderrTail=stderr
}finally{
 if(child.exitCode===null&&!spawnError)child.kill()
 let timer
 try{await Promise.race([exited,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Owned media probe did not stop')),10000)})])}finally{clearTimeout(timer)}
 result.ownedProcessStopped=true
 writeFileSync(report,JSON.stringify(result,null,2),{flag:'wx'})
 console.log(JSON.stringify({ready:result.ready,elapsedSeconds:result.elapsedSeconds,availableDiffusionModels:result.availableDiffusionModels,
  exitCode:result.exitCode,ownedProcessStopped:true,modelGenerationTested:false,report}))
}
if(!result.ready)process.exitCode=1
