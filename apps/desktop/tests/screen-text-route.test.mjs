import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {spawnSync} from 'node:child_process'
import {resolve,join} from 'node:path'
import {structuredScreenCapability,structuredScreenFindings} from '../bridge/local-chat.mjs'
import {perceiveScreenRequest} from '../bridge/screen-perception.mjs'

const root=resolve(import.meta.dirname,'../../..')
const environment={...process.env,NORI_ROOT:root,NORI_VISION_BACKEND:'windows-ocr'}

test('desktop selects Nori-owned OCR for shared-screen text without enabling a vision model',()=>{
  const main=readFileSync(join(root,'apps/desktop/desktop/main.cjs'),'utf8')
  assert.match(main,/NORI_VISION_BACKEND:\s*'windows-ocr'/)
  assert.match(main,/NORI_VISION_MODEL:\s*''/)
  assert.match(main,/Scene\/image understanding remains unavailable/)
})

test('explicit Windows screen-text capability does not fetch an Ollama model',{skip:process.platform!=='win32'},async()=>{
  let fetches=0
  const result=await structuredScreenCapability({environment,fetcher:async()=>{fetches++;throw Error('Network forbidden')}})
  assert.equal(fetches,0)
  assert.equal(result.available,true)
  assert.equal(result.backendId,'nori-windows-ocr-v1')
  assert.equal(result.modelId,null)
  assert.equal(result.structuredOutput,true)
})

test('real screen-request route reads synthetic text without invoking the model analyzer',{skip:process.platform!=='win32'},async()=>{
  const image=spawnSync(join(process.env.SystemRoot,'System32/WindowsPowerShell/v1.0/powershell.exe'),
    ['-NoProfile','-File',join(root,'runtime/vision/probe-windows-ocr.ps1'),'-ImageOnly'],
    {encoding:'utf8',timeout:10000,windowsHide:true,maxBuffer:3000000})
  assert.equal(image.status,0,image.stderr)
  let modelCalls=0
  const request={id:'route-ocr',sampleId:'synthetic-route',source:'screen',capturedAt:Date.now(),frame:{data:image.stdout,mimeType:'image/png'}}
  const result=await perceiveScreenRequest(request,{environment,analyze:async()=>{modelCalls++;throw Error('Model forbidden')}})
  assert.equal(modelCalls,0)
  assert.equal(result.ok,true)
  assert.equal(result.response.status,'ok')
  assert.equal(result.response.requestId,request.id)
  assert.equal(result.response.sampleId,request.sampleId)
  assert.equal(result.response.backendId,'nori-windows-ocr-v1')
  assert.deepEqual(result.response.findings,[{kind:'visible_text',value:'NORI LOCAL SCREEN TEST'}])
  assert.equal('modelId' in result.response,false)
})

test('OCR configuration cannot fall through the direct vision-model interface',async()=>{
  let fetches=0
  await assert.rejects(structuredScreenFindings({image:'aGVsbG8=',environment,
    fetcher:async()=>{fetches++;throw Error('Network forbidden')}}),/explicit OCR route/)
  assert.equal(fetches,0)
})

test('screen-text route refuses invalid and pre-cancelled frames without model fallback',async()=>{
  let calls=0
  const analyze=async()=>{calls++;throw Error('Model forbidden')}
  assert.equal((await perceiveScreenRequest({}, {environment,analyze})).ok,false)
  const controller=new AbortController();controller.abort()
  const request={id:'cancelled-route',sampleId:'not-captured',source:'screen',capturedAt:Date.now(),frame:{data:'aGVsbG8=',mimeType:'image/png'}}
  const result=await perceiveScreenRequest(request,{environment,analyze,signal:controller.signal})
  assert.equal(result.response.status,'error')
  assert.equal(result.response.errorCode,'request_aborted')
  assert.deepEqual(result.response.findings,[])
  assert.equal(calls,0)
})
