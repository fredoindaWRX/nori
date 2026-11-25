import test from 'node:test'
import assert from 'node:assert/strict'
import {spawnSync} from 'node:child_process'
import {resolve,join} from 'node:path'
import {perceiveNativeScreenText,extractUserAttachmentText} from '../bridge/native-screen-text.mjs'
import {validateScreenPerceptionResponse} from '../bridge/screen-perception-contract.mjs'
const root=resolve(import.meta.dirname,'../../..')
test('OCR provenance never grants scene understanding, model identity or fabricated confidence',()=>{
  const now=Date.now(),base={schemaVersion:1,requestId:'r',sampleId:'s',source:'screen',capturedAt:now,observedAt:now,status:'ok',backendId:'nori-windows-ocr-v1',findings:[{kind:'visible_text',value:'literal'}]}
  const expected={requestId:'r',sampleId:'s',capturedAt:now,now}
  assert.equal(validateScreenPerceptionResponse(base,expected).ok,true)
  for(const patch of [{modelId:'fake-model'},{findings:[{kind:'application',value:'invented'}]},{findings:[{kind:'visible_text',value:'literal',confidence:1}]}])
    assert.equal(validateScreenPerceptionResponse({...base,...patch},expected).ok,false)
})
test('invalid screen-text input and pre-aborted request never produce findings',async()=>{
  assert.equal((await perceiveNativeScreenText({})).ok,false)
  const now=Date.now(),request={id:'test',sampleId:'sample',source:'screen',capturedAt:now,frame:{data:'aGVsbG8=',mimeType:'image/png'}}
  const controller=new AbortController();controller.abort()
  const result=await perceiveNativeScreenText(request,{signal:controller.signal})
  assert.equal(result.response.status,'error');assert.equal(result.response.errorCode,'request_aborted')
  assert.deepEqual(result.response.findings,[])
})
test('user image OCR has a separate attachment contract and rejects invalid data',async()=>{
  for(const frame of [null,{}, {data:'aGVsbG8=',mimeType:'text/plain'},
    {data:'not-base64',mimeType:'image/png'}, {data:'aGVsbG8=',mimeType:'image/png',extra:true},
    {data:'A'.repeat(3_000_004),mimeType:'image/png'}]) {
    const result=await extractUserAttachmentText(frame)
    assert.equal(result.ok,false)
    assert.equal(result.errorCode,'invalid_attachment')
  }
  const controller=new AbortController();controller.abort()
  assert.deepEqual(await extractUserAttachmentText({data:'aGVsbG8=',mimeType:'image/png'},
    {signal:controller.signal}),{ok:false,errorCode:'request_aborted'})
})
test('actual Windows OCR reads synthetic text with bound sample provenance and no scene claims',{skip:process.platform!=='win32'},async()=>{
  const image=spawnSync(join(process.env.SystemRoot,'System32/WindowsPowerShell/v1.0/powershell.exe'),
    ['-NoProfile','-File',join(root,'runtime/vision/probe-windows-ocr.ps1'),'-ImageOnly'],{encoding:'utf8',timeout:10000,windowsHide:true,maxBuffer:3000000})
  assert.equal(image.status,0,image.stderr)
  const request={id:'synthetic-ocr',sampleId:'synthetic-screen-only',source:'screen',capturedAt:Date.now(),frame:{data:image.stdout,mimeType:'image/png'}}
  const result=await perceiveNativeScreenText(request)
  assert.equal(result.ok,true);assert.equal(result.response.status,'ok')
  assert.equal(result.response.sampleId,request.sampleId)
  assert.equal(result.response.backendId,'nori-windows-ocr-v1')
  assert.deepEqual(result.response.findings,[{kind:'visible_text',value:'NORI LOCAL SCREEN TEST'}])
  const attachment=await extractUserAttachmentText({data:image.stdout,mimeType:'image/png'})
  assert.deepEqual(attachment,{ok:true,text:'NORI LOCAL SCREEN TEST'})
})
test('actual decoder refuses malformed image and oversized dimensions without findings',{skip:process.platform!=='win32'},async()=>{
  const request=data=>({id:'bad-image',sampleId:'synthetic-only',source:'screen',capturedAt:Date.now(),frame:{data,mimeType:'image/png'}})
  const invalid=await perceiveNativeScreenText(request('aGVsbG8='))
  assert.equal(invalid.response.status,'error');assert.deepEqual(invalid.response.findings,[])
  const maximum=spawnSync('powershell.exe',['-NoProfile','-Command','[Windows.Media.Ocr.OcrEngine,Windows.Foundation,ContentType=WindowsRuntime]::MaxImageDimension'],{encoding:'utf8',timeout:10000})
  assert.equal(maximum.status,0)
  const width=Number(maximum.stdout.trim())+1
  assert.ok(Number.isInteger(width)&&width>1&&width<=16384)
  const image=spawnSync('powershell.exe',['-NoProfile','-File',join(root,'runtime/vision/probe-windows-ocr.ps1'),'-ImageOnly','-Width',String(width)],{encoding:'utf8',timeout:10000,maxBuffer:3000000})
  assert.equal(image.status,0,image.stderr)
  const oversized=await perceiveNativeScreenText(request(image.stdout))
  assert.equal(oversized.response.status,'error');assert.deepEqual(oversized.response.findings,[])
})
