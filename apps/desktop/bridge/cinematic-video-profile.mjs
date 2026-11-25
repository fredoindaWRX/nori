/** Reference-guided local video profile; no cloud endpoint or arbitrary graph input. */
import {createHash,randomUUID} from 'node:crypto'
import {readFile,stat} from 'node:fs/promises'
import {isAbsolute,extname} from 'node:path'
import {freemem} from 'node:os'
import {execFile} from 'node:child_process'
import {promisify} from 'node:util'
import {resolveVideoDurationSeconds} from './video-duration.mjs'

export const CINEMATIC_SCHEMA='nori.neuralese.cinematic-video-intent.v1'
const run=promisify(execFile)
const MODEL='wan2.2_ti2v_5B_fp16.safetensors'
const MAX_IMAGE=12*1024*1024
const checksum=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex')
const keys=['schema','version','correlationId','prompt','referencePath','referenceSha256','totalFrames']

export function resolveCinematicVideoRequest(goal=''){
  if(typeof goal!=='string'||!/\b(?:create|make|generate|render|produce)\b/i.test(goal)||
    !/\b(?:video|clip)\b/i.test(goal)||!/\b(?:cinematic|reference-guided|wan\s*2\.2)\b/i.test(goal)||
    /\b(?:do not|don't|never|cancel|stop)\b/i.test(goal))return null
  const paths=[...goal.matchAll(/"([^"\r\n]+\.(?:png|jpe?g|webp))"/gi)]
  if(paths.length!==1)throw new Error('A cinematic video needs one explicitly supplied image path in double quotes.')
  if(!isAbsolute(paths[0][1]))throw new Error('The reference image path must be absolute.')
  return Object.freeze({prompt:goal,referencePath:paths[0][1],durationSeconds:resolveVideoDurationSeconds(goal)})
}

export async function checkedReference(path,expectedHash){
  if(typeof path!=='string'||!isAbsolute(path)||!['.png','.jpg','.jpeg','.webp'].includes(extname(path).toLowerCase()))throw new TypeError('Unsupported cinematic reference path.')
  const info=await stat(path)
  if(!info.isFile()||info.size<12||info.size>MAX_IMAGE)throw new Error('Reference image must be a regular file under 12 MiB.')
  const bytes=await readFile(path)
  if(bytes.length<12||bytes.length>MAX_IMAGE)throw new Error('Reference image changed size or exceeds 12 MiB.')
  const png=bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))
  const jpeg=bytes[0]===255&&bytes[1]===216&&bytes[2]===255
  const webp=bytes.toString('ascii',0,4)==='RIFF'&&bytes.toString('ascii',8,12)==='WEBP'
  if(!png&&!jpeg&&!webp)throw new Error('Reference image contents do not match a supported image format.')
  const sha256=createHash('sha256').update(bytes).digest('hex')
  if(expectedHash&&sha256!==expectedHash)throw new Error('Reference image changed after the request was prepared.')
  return {bytes,sha256,mimeType:png?'image/png':jpeg?'image/jpeg':'image/webp',extension:png?'png':jpeg?'jpg':'webp'}
}

export async function encodeCinematicVideoIntent({prompt,referencePath,durationSeconds,correlationId=randomUUID()}){
  if(typeof prompt!=='string'||!prompt.trim()||Buffer.byteLength(prompt)>12000)throw new TypeError('Invalid cinematic video prompt.')
  if(!Number.isFinite(durationSeconds)||durationSeconds<=0||durationSeconds>30)throw new RangeError('The cinematic profile currently supports a requested duration up to 30 seconds.')
  const ref=await checkedReference(referencePath)
  const unsigned={schema:CINEMATIC_SCHEMA,version:1,correlationId,prompt,referencePath,referenceSha256:ref.sha256,totalFrames:Math.ceil(durationSeconds*24)}
  const frame={...unsigned,frame_sha256:checksum(unsigned)}
  decodeCinematicVideoIntent(frame)
  return Object.freeze(frame)
}

export function decodeCinematicVideoIntent(frame){
  if(!frame||Object.getPrototypeOf(frame)!==Object.prototype)throw new TypeError('Malformed cinematic video frame.')
  const desc=Object.getOwnPropertyDescriptors(frame)
  if(Reflect.ownKeys(desc).some(k=>typeof k!=='string'||!Object.hasOwn(desc[k],'value'))||
    Object.keys(desc).sort().join(',')!==[...keys,'frame_sha256'].sort().join(','))throw new TypeError('Malformed cinematic video frame.')
  const data=Object.fromEntries(Object.entries(desc).map(([k,v])=>[k,v.value]))
  const {frame_sha256,...unsigned}=data
  if(data.schema!==CINEMATIC_SCHEMA||data.version!==1||!/^[a-f0-9-]{36}$/i.test(data.correlationId)||
    typeof data.prompt!=='string'||!data.prompt.trim()||Buffer.byteLength(data.prompt)>12000||
    typeof data.referencePath!=='string'||!isAbsolute(data.referencePath)||
    !/^[a-f0-9]{64}$/.test(data.referenceSha256)||!Number.isSafeInteger(data.totalFrames)||data.totalFrames<1||data.totalFrames>720||
    frame_sha256!==checksum(unsigned))throw new Error('Cinematic video integrity or profile validation failed.')
  const {schema,version,frame_sha256:ignored,...payload}=data
  return Object.freeze({...payload,model:MODEL,width:704,height:1280,frames:121,fps:24,
    durationSeconds:data.totalFrames/24,segmentCount:Math.ceil(data.totalFrames/121),untrustedPayload:true})
}

export function cinematicWorkflow(intent,seed,filenamePrefix,referenceName){
  if(intent.model!==MODEL||intent.width!==704||intent.height!==1280||intent.frames!==121||intent.fps!==24||
    typeof referenceName!=='string'||!/^[a-z0-9-]+\.(?:png|jpg|webp)$/.test(referenceName))throw new TypeError('Unsupported cinematic workflow profile.')
  return {
    '1':{class_type:'CLIPLoader',inputs:{clip_name:'umt5_xxl_fp8_e4m3fn_scaled.safetensors',type:'wan',device:'cpu'}},
    '2':{class_type:'VAELoader',inputs:{vae_name:'wan2.2_vae.safetensors'}},
    '3':{class_type:'CLIPTextEncode',inputs:{clip:['1',0],text:intent.prompt}},
    '4':{class_type:'CLIPTextEncode',inputs:{clip:['1',0],text:'blurry, low quality, distorted geometry, flicker, unstable subject identity, sudden camera jumps'}},
    '5':{class_type:'UNETLoader',inputs:{unet_name:MODEL,weight_dtype:'default'}},
    '6':{class_type:'ModelSamplingSD3',inputs:{model:['5',0],shift:8}},
    '7':{class_type:'Wan22ImageToVideoLatent',inputs:{vae:['2',0],width:704,height:1280,length:121,batch_size:1,start_image:['12',0]}},
    '8':{class_type:'KSampler',inputs:{model:['6',0],positive:['3',0],negative:['4',0],latent_image:['7',0],seed,steps:20,cfg:5,sampler_name:'uni_pc',scheduler:'simple',denoise:1}},
    '9':{class_type:'VAEDecode',inputs:{samples:['8',0],vae:['2',0]}},
    '10':{class_type:'CreateVideo',inputs:{images:['9',0],fps:24}},
    '11':{class_type:'SaveVideo',inputs:{video:['10',0],filename_prefix:filenamePrefix,format:'mp4','format.codec':'h264'}},
    '12':{class_type:'LoadImage',inputs:{image:referenceName}},
  }
}

export async function cinematicResourceCheck({readGpu,readRAM=freemem}={}){
  const free=readGpu?await readGpu():Number((await run('nvidia-smi',['--query-gpu=memory.free','--format=csv,noheader,nounits'],{windowsHide:true,timeout:10000})).stdout.trim().split(/\r?\n/)[0])*1024**2
  const ram=readRAM()
  if(!Number.isFinite(free)||free<8*1024**3||ram<10*1024**3)throw new Error(`Cinematic rendering needs free resources before dispatch: ${Number.isFinite(free)?(free/1024**3).toFixed(1):'unknown'} GiB VRAM and ${(ram/1024**3).toFixed(1)} GiB RAM available. No video shot was queued.`)
  return Object.freeze({freeVRAM:free,freeRAM:ram})
}
