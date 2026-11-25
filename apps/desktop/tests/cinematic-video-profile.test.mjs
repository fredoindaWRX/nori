import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,writeFile,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {encodeCinematicVideoIntent,decodeCinematicVideoIntent,checkedReference,resolveCinematicVideoRequest,cinematicResourceCheck,cinematicWorkflow} from '../bridge/cinematic-video-profile.mjs'

async function fixture(run){
  const root=await mkdtemp(join(tmpdir(),'nori-cinematic-'))
  const path=join(root,'reference.png')
  // Exact input validation fixture, not a renderable image or rendering proof.
  await writeFile(path,Buffer.from([137,80,78,71,13,10,26,10,0,0,0,0,0,0,0,0]))
  try{await run(path)}finally{await rm(root,{recursive:true,force:true})}
}

test('cinematic routing requires an explicit image and preserves duration',()=>{
  assert.equal(resolveCinematicVideoRequest('Create a logo'),null)
  assert.equal(resolveCinematicVideoRequest('Do not make a cinematic video'),null)
  assert.throws(()=>resolveCinematicVideoRequest('Make a cinematic video'),/one explicitly supplied/)
  const req=resolveCinematicVideoRequest('Create a 5-second cinematic video from "C:\\Nori\\frame.png" of roots.')
  assert.equal(req.durationSeconds,5);assert.equal(req.referencePath,'C:\\Nori\\frame.png')
})

test('reference-bound frames reject tampering and changed reference bytes',()=>fixture(async path=>{
  const frame=await encodeCinematicVideoIntent({prompt:'Forest camera glide',referencePath:path,durationSeconds:5})
  const decoded=decodeCinematicVideoIntent(frame)
  assert.equal(decoded.totalFrames,120);assert.equal(decoded.segmentCount,1)
  assert.equal(decoded.model,'wan2.2_ti2v_5B_fp16.safetensors')
  assert.throws(()=>decodeCinematicVideoIntent({...frame,totalFrames:240}),/integrity/)
  let invoked=false
  const hostile={...frame};Object.defineProperty(hostile,'prompt',{get(){invoked=true;return 'unsafe'},enumerable:true})
  assert.throws(()=>decodeCinematicVideoIntent(hostile),/Malformed/);assert.equal(invoked,false)
  await writeFile(path,Buffer.from([137,80,78,71,13,10,26,10,0,0,0,0,0,0,0,1]))
  await assert.rejects(checkedReference(path,frame.referenceSha256),/changed/)
}))

test('text disguised as an image and unsupported durations are rejected',()=>fixture(async path=>{
  await writeFile(path,'this is not a real image despite the png filename')
  await assert.rejects(encodeCinematicVideoIntent({prompt:'Forest',referencePath:path,durationSeconds:5}),/contents/)
  await assert.rejects(encodeCinematicVideoIntent({prompt:'Forest',referencePath:path,durationSeconds:31}),/up to 30/)
}))

test('resource preflight refuses insufficient VRAM or RAM without a render',async()=>{
  const GiB=1024**3
  await assert.rejects(cinematicResourceCheck({readGpu:async()=>GiB,readRAM:()=>20*GiB}),/No video shot was queued/)
  await assert.rejects(cinematicResourceCheck({readGpu:async()=>12*GiB,readRAM:()=>8*GiB}),/free resources/)
  const result=await cinematicResourceCheck({readGpu:async()=>12*GiB,readRAM:()=>18*GiB})
  assert.equal(result.freeVRAM,12*GiB)
})

test('reference-guided graph cannot substitute another model or arbitrary input path',()=>fixture(async path=>{
  const frame=await encodeCinematicVideoIntent({prompt:'Forest',referencePath:path,durationSeconds:5})
  const intent=decodeCinematicVideoIntent(frame)
  const graph=cinematicWorkflow(intent,26,'nori/jobs/test/shot','nori-123.png')
  assert.equal(graph['7'].class_type,'Wan22ImageToVideoLatent')
  assert.deepEqual(graph['7'].inputs.start_image,['12',0])
  assert.equal(graph['1'].inputs.device,'cpu')
  assert.doesNotMatch(graph['4'].inputs.text,/roots|forest|flat gray|cartoon/)
  assert.throws(()=>cinematicWorkflow({...intent,model:'other'},26,'nori/test','nori-123.png'),/Unsupported/)
  assert.throws(()=>cinematicWorkflow(intent,26,'nori/test','../../private.png'),/Unsupported/)
}))
