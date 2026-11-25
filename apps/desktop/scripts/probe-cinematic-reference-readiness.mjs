import assert from 'node:assert/strict'
import {execFile} from 'node:child_process'
import {promisify} from 'node:util'
import {freemem} from 'node:os'
import {existsSync,writeFileSync} from 'node:fs'
import {encodeCinematicVideoIntent,decodeCinematicVideoIntent,cinematicResourceCheck} from '../bridge/cinematic-video-profile.mjs'
const report='C:/Nori/.work/reports/cinematic-reference-readiness.json'
assert.ok(!existsSync(report),'Existing readiness evidence preserved')
const referencePath='C:/Nori/.work/image-model-team-live/output/nori-251df5ee-ac6c-4544-a393-6ee122a6b156_00001_.png'
const frame=await encodeCinematicVideoIntent({prompt:'The same blue rally car and gold wheels, slow camera move, stable bodywork, Japanese neon street at night.',referencePath,durationSeconds:5})
const intent=decodeCinematicVideoIntent(frame)
assert.equal(intent.referenceSha256,'d78ae155267a3947c9a5da4ae3ec2ec1561818444e5e56605057785b3b28b832')
const {stdout}=await promisify(execFile)('C:/Windows/System32/nvidia-smi.exe',['--query-gpu=memory.free','--format=csv,noheader,nounits'],{windowsHide:true,timeout:5000,maxBuffer:4096})
assert.match(stdout.trim(),/^\d+$/)
const freeVRAM=Number(stdout.trim())*1024**2,freeRAM=freemem()
const evidence={scope:'real reference hash binding and current hardware readiness only; no generation',referencePath,referenceSha256:intent.referenceSha256,model:intent.model,requestedFrames:intent.totalFrames,fps:intent.fps,width:intent.width,height:intent.height,freeVRAM,freeRAM,requiredFreeVRAM:8*1024**3,requiredFreeRAM:10*1024**3,shotQueued:false,modelStarted:false,installedAppUpdated:false}
try{await cinematicResourceCheck({readGpu:async()=>freeVRAM,readRAM:()=>freeRAM});evidence.ready=true}
catch(error){evidence.ready=false;evidence.reason=error.message}
writeFileSync(report,JSON.stringify(evidence,null,2),{flag:'wx'})
console.log(JSON.stringify(evidence))
