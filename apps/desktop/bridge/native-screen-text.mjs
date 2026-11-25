// Screen-text primitive, not a vision model or permission to capture a display.
import {realpathSync,statSync} from 'node:fs'
import {isAbsolute,join,relative} from 'node:path'
import {installationPaths} from './installation-paths.mjs'
import {validateScreenPerceptionRequest,validateScreenPerceptionResponse} from './screen-perception-contract.mjs'
import {runScreenTextWorker} from './screen-text-process.mjs'
const sensitive=/\b(?:password|passcode|one[- ]time code|verification code|recovery code|private message|direct message|email body|bank account|credit card|social security|medical record)\b/i
const attachmentMimeTypes=new Set(['image/jpeg','image/png','image/webp'])
const attachmentBase64=/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/
const attachmentTextLimit=6000

// User attachments are not live screen captures, so they use a separate
// contract and never inherit screen provenance or scene-understanding claims.
export async function extractUserAttachmentText(frame,{signal,environment=process.env}={}) {
  if(!frame||typeof frame!=='object'||Array.isArray(frame)||
    Object.keys(frame).some(key=>!['data','mimeType'].includes(key))||
    typeof frame.data!=='string'||frame.data.length<4||frame.data.length>3_000_000||
    frame.data.length%4!==0||!attachmentBase64.test(frame.data)||!attachmentMimeTypes.has(frame.mimeType))
    return {ok:false,errorCode:'invalid_attachment'}
  if(signal?.aborted)return {ok:false,errorCode:'request_aborted'}
  if(process.platform!=='win32')return {ok:false,errorCode:'ocr_unavailable'}
  let root,worker
  try{
    root=realpathSync(installationPaths(environment).noriRoot)
    worker=realpathSync(join(root,'runtime/vision/windows-ocr.ps1'))
    const delta=relative(root,worker)
    if(delta.startsWith('..')||isAbsolute(delta)||!statSync(worker).isFile())return {ok:false,errorCode:'ocr_unavailable'}
  }catch{return {ok:false,errorCode:'ocr_unavailable'}}
  const raw=await runScreenTextWorker({root,worker,image:frame.data,signal,environment})
  if(signal?.aborted)return {ok:false,errorCode:'request_aborted'}
  if(typeof raw!=='string'||raw.length>32_768)return {ok:false,errorCode:'ocr_unavailable'}
  try{
    const parsed=JSON.parse(raw)
    if(parsed.schema!=='nori.windows-ocr.v1'||parsed.backend!=='windows-ocr'||parsed.sceneUnderstanding!==false||
      !Array.isArray(parsed.lines)||parsed.lines.length<1||parsed.lines.length>24||parsed.lines.some(line=>typeof line!=='string'||!line.trim()||line.length>1000||sensitive.test(line)))
      return {ok:false,errorCode:'ocr_unavailable'}
    const text=parsed.lines.map(line=>line.trim()).join('\n')
    if(text.length>attachmentTextLimit)return {ok:false,errorCode:'ocr_unavailable'}
    return {ok:true,text}
  }catch{return {ok:false,errorCode:'ocr_unavailable'}}
}

export async function nativeScreenTextCapability({signal,environment=process.env}={}) {
  const result={available:false,backendId:'nori-windows-ocr-v1',modelId:null,imageCapable:false,structuredOutput:false}
  if(process.platform!=='win32'||signal?.aborted)return {...result,errorCode:'ocr_unavailable'}
  try{
    const root=realpathSync(installationPaths(environment).noriRoot)
    const worker=realpathSync(join(root,'runtime/vision/windows-ocr.ps1'))
    const delta=relative(root,worker)
    if(delta.startsWith('..')||isAbsolute(delta)||!statSync(worker).isFile())throw Error('Invalid worker path')
    const raw=await runScreenTextWorker({root,worker,image:'',signal,environment,capabilityProbe:true})
    const parsed=JSON.parse(raw)
    if(parsed.schema!=='nori.windows-ocr-capability.v1'||parsed.available!==true||parsed.sceneUnderstanding!==false)throw Error('OCR unavailable')
    return {...result,available:true,imageCapable:true,structuredOutput:true}
  }catch(error){
    if(error?.code==='NORI_OCR_CLEANUP_FAILED')throw error
    return {...result,errorCode:'ocr_unavailable'}
  }
}
export async function perceiveNativeScreenText(value,{signal,now=Date.now,environment=process.env}={}) {
  const checked=validateScreenPerceptionRequest(value,{now:now()})
  if(!checked.ok)return checked
  const request=checked.request
  const envelope={schemaVersion:1,requestId:request.id,sampleId:request.sampleId,source:'screen',
    capturedAt:request.capturedAt,backendId:'nori-windows-ocr-v1'}
  const failed=()=>({ok:true,response:{...envelope,observedAt:now(),status:'error',findings:[],errorCode:signal?.aborted?'request_aborted':'perception_unavailable'}})
  if(signal?.aborted||process.platform!=='win32')return failed()
  let root,worker
  try{
    root=realpathSync(installationPaths(environment).noriRoot)
    worker=realpathSync(join(root,'runtime/vision/windows-ocr.ps1'))
    const delta=relative(root,worker)
    if(delta.startsWith('..')||isAbsolute(delta)||!statSync(worker).isFile())return failed()
  }catch{return failed()}
  const raw=await runScreenTextWorker({root,worker,image:request.frame.data,signal,environment})
  try{
    const parsed=JSON.parse(raw)
    if(parsed.schema!=='nori.windows-ocr.v1'||parsed.backend!=='windows-ocr'||parsed.sceneUnderstanding!==false||
      !Array.isArray(parsed.lines)||parsed.lines.length>24||parsed.lines.some(text=>typeof text!=='string'||!text.trim()||text.length>1000||sensitive.test(text)))return failed()
    const findings=parsed.lines.map(value=>({kind:'visible_text',value:value.trim()}))
    const response={...envelope,observedAt:now(),status:findings.length?'ok':'no_findings',findings}
    return validateScreenPerceptionResponse(response,{requestId:request.id,sampleId:request.sampleId,capturedAt:request.capturedAt,now:now()})
  }catch{return failed()}
}
