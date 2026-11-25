import {spawn} from 'node:child_process'
import {createRequire} from 'node:module'
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs'
import {pathToFileURL} from 'node:url'
import {join} from 'node:path'
import {createServer} from 'node:net'
import {createHash} from 'node:crypto'
const installed='C:/Program Files/Nori',archive=join(installed,'resources/app.asar')
const require=createRequire(pathToFileURL(join(archive,'desktop/main.cjs')))
const {comfyLaunchArgs,waitForComfyStartup}=require('./comfy-startup.cjs')
const state=mkdtempSync('C:/Nori/verification/hallows-video-')
const root=join(installed,'resources/NoriSuite/integrations/image-generation/runtime/ComfyUI_windows_portable')
const socket=createServer()
await new Promise((resolve,reject)=>{socket.once('error',reject);socket.listen(0,'127.0.0.1',resolve)})
const port=socket.address().port
await new Promise(resolve=>socket.close(resolve))
const endpoint=`http://127.0.0.1:${port}`
process.env.NORI_COMFY_URL=endpoint
process.env.NORI_APP_DATA_ROOT=state
for(const name of ['input','output','temp','user'])mkdirSync(join(state,'image-runtime',name),{recursive:true})
const args=comfyLaunchArgs({inputDirectory:join(state,'image-runtime/input'),outputDirectory:join(state,'image-runtime/output'),
  tempDirectory:join(state,'image-runtime/temp'),userDirectory:join(state,'image-runtime/user'),port})
const child=spawn(join(root,'python_embeded/python.exe'),args,{cwd:join(root,'ComfyUI'),windowsHide:true,shell:false,stdio:['ignore','ignore','pipe']})
let stderr=''
child.stderr.on('data',bytes=>{stderr=(stderr+bytes.toString()).slice(-5000)})
const exited=new Promise(resolve=>child.once('exit',resolve))
const report={passed:false,installedProvider:true,localOnly:true,uiVerified:false,state}
try{
  const ready=await waitForComfyStartup(child,async()=>{
    try{return (await fetch(endpoint+'/system_stats',{signal:AbortSignal.timeout(700)})).ok}catch{return false}
  })
  if(ready.status!=='ready')throw Error('ComfyUI startup failed: '+JSON.stringify(ready))
  const {generateLocalVideo}=await import(pathToFileURL(join(archive,'bridge/local-video.mjs')))
  const {encodeNeuraleseVideoIntent}=await import(pathToFileURL(join(archive,'bridge/neuralese-video-intent.mjs')))
  const prompt='Photorealistic cinematic view from inside a cozy room looking through a real window on Hallows Eve. Rain droplets slide down the glass at different speeds. Orange and brown autumn leaves fall outside. A soft diffused streetlamp lights a wet quiet street, with gentle reflections on the glass and pavement and a faint distant mist. Realistic textures, natural lighting, fixed camera, subtle continuous motion, no text.'
  const video=await generateLocalVideo(encodeNeuraleseVideoIntent(prompt))
  const bytes=readFileSync(video.path)
  report.passed=true;report.video=video;report.sha256=createHash('sha256').update(bytes).digest('hex')
}catch(error){report.error=String(error.stack||error).slice(0,3000);report.runtimeError=stderr;process.exitCode=1}
finally{
  if(child.exitCode===null)child.kill()
  await exited
  writeFileSync(join(state,'receipt.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'})
  console.log(JSON.stringify(report))
}
