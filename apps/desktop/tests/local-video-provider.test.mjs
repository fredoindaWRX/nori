import test from 'node:test'
import assert from 'node:assert/strict'
import {createServer} from 'node:http'
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync,existsSync,symlinkSync,unlinkSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join,dirname,basename} from 'node:path'
import {encodeNeuraleseVideoIntent} from '../bridge/neuralese-video-intent.mjs'
import {encodeCinematicVideoIntent} from '../bridge/cinematic-video-profile.mjs'

// Fake bytes qualify orchestration only; assembly tests exercise real codecs.
async function fixture(run,{warmup=0,neverReady=false,complete=true,cancelUnavailable=false,ackDelayMs=0,cinematicRegistered=true,wrongUploadName=false}={}) {
  const temp=mkdtempSync(join(tmpdir(),'nori-wan-adapter-'))
  const keys=['NORI_APP_DATA_ROOT','NORI_COMFY_URL'], previous=keys.map(k=>process.env[k])
  const posts=[],cancelled=[],queueDeletes=[],progress=[]
  let readiness=0,assembly=null
  const server=createServer(async(req,res)=>{
    const json=value=>res.writeHead(200,{'content-type':'application/json'}).end(JSON.stringify(value))
    if(req.url==='/system_stats'){readiness++;res.writeHead(neverReady||readiness<=warmup?503:200).end('{}');return}
    if(req.url==='/object_info')return json({UNETLoader:{input:{required:{unet_name:[cinematicRegistered?['wan2.2_ti2v_5B_fp16.safetensors']:[]]}}},VAELoader:{input:{required:{vae_name:[['wan2.2_vae.safetensors']]}}}})
    if(req.url==='/upload/image'){
      const chunks=[];for await(const part of req)chunks.push(part)
      const name=Buffer.concat(chunks).toString('latin1').match(/filename="([^"]+)"/)?.[1]
      return json({name:wrongUploadName?'wrong.png':name,subfolder:''})
    }
    if(req.method==='POST'){
      let raw='';for await(const part of req)raw+=part
      const body=JSON.parse(raw)
      if(req.url==='/prompt'){
        posts.push(body)
        if(ackDelayMs)await new Promise(done=>setTimeout(done,ackDelayMs))
        return json({prompt_id:body.prompt_id})
      }
      if(/^\/api\/jobs\/[a-f0-9-]+\/cancel$/.test(req.url)){
        cancelled.push(req.url);if(cancelUnavailable)return res.writeHead(404).end('{}');return json({})
      }
      if(req.url==='/queue'){queueDeletes.push(body);return json({})}
      assert.notEqual(req.url,'/interrupt','must never send global interrupt')
    }
    if(req.url.startsWith('/history/')){
      const id=req.url.split('/').at(-1),index=posts.findIndex(post=>post.prompt_id===id)
      if(!complete)return json({})
      const prefix=posts[index].prompt['11'].inputs.filename_prefix
      const file=join(temp,'image-runtime','output',prefix+'_00001_.mp4')
      mkdirSync(dirname(file),{recursive:true});writeFileSync(file,'synthetic-shot')
      return json({[id]:{status:{status_str:'success',completed:true},outputs:{'11':{images:[{
        filename:basename(file),subfolder:dirname(prefix).replaceAll('\\','/'),type:'output',
      }]}}}})
    }
    res.writeHead(404).end('{}')
  })
  await new Promise(done=>server.listen(0,'127.0.0.1',done))
  process.env.NORI_APP_DATA_ROOT=temp;process.env.NORI_COMFY_URL='http://127.0.0.1:'+server.address().port
  const {generateLocalVideo}=await import('../bridge/local-video.mjs?fixture-'+Math.random())
  const assembleVideo=async job=>{
    assembly=job;writeFileSync(job.outputPath,'synthetic-assembled-output')
    job.onProgress?.({stage:'verifying'})
    return {frameCount:job.totalFrames,durationSeconds:job.totalFrames/job.fps}
  }
  try {await run({temp,posts,cancelled,queueDeletes,progress,readiness:()=>readiness,assembly:()=>assembly,
    generate:(frame,options={})=>generateLocalVideo(frame,{timeoutMs:5000,assembleVideo,onProgress:p=>progress.push(p),...options})})}
  finally{
    keys.forEach((key,i)=>previous[i]===undefined?delete process.env[key]:process.env[key]=previous[i])
    server.closeAllConnections();await new Promise(done=>server.close(done))
    rmSync(temp,{recursive:true,force:true})
  }
}

test('cinematic provider binds the uploaded reference and exports through current SaveVideo inputs',()=>fixture(async f=>{
  // Header-only bytes and fake MP4s test orchestration, not image decoding or visual quality.
  const path=join(f.temp,'reference.png');writeFileSync(path,Buffer.from([137,80,78,71,13,10,26,10,0,0,0,0]))
  const frame=await encodeCinematicVideoIntent({prompt:'Forest roots',referencePath:path,durationSeconds:5})
  const result=await f.generate(frame,{cinematicResources:async()=>({})})
  assert.equal(result.frameCount,120);assert.equal(result.durationSeconds,5)
  assert.equal(f.posts.length,1)
  const graph=f.posts[0].prompt
  assert.match(graph['12'].inputs.image,/^nori-[a-f0-9-]+\.png$/)
  assert.deepEqual(graph['7'].inputs.start_image,['12',0])
  assert.equal(graph['11'].inputs.format,'mp4')
  assert.equal(graph['11'].inputs['format.codec'],'h264')
  assert.equal(f.assembly().width,704);assert.equal(f.assembly().height,1280)
}))

for(const reason of ['resources','catalog','upload'])test('cinematic preflight '+reason+' failure dispatches no GPU shot',()=>fixture(async f=>{
  const path=join(f.temp,'reference.png');writeFileSync(path,Buffer.from([137,80,78,71,13,10,26,10,0,0,0,0]))
  const frame=await encodeCinematicVideoIntent({prompt:'Forest roots',referencePath:path,durationSeconds:5})
  await assert.rejects(f.generate(frame,{cinematicResources:async()=>{if(reason==='resources')throw Error('Insufficient resources')}}),reason==='resources'?/Insufficient/:reason==='catalog'?/not registered/:/upload/)
  assert.equal(f.posts.length,0);assert.equal(f.assembly(),null)
},{cinematicRegistered:reason!=='catalog',wrongUploadName:reason==='upload'}))

test('requested5seconds renders3 distinctshots then verifies exactly80frames',async()=>fixture(async f=>{
  const result=await f.generate(encodeNeuraleseVideoIntent('Create a 5-second video of a red car.'))
  assert.equal(result.durationSeconds,5);assert.equal(result.frameCount,80);assert.equal(result.shots,3)
  assert.equal(f.posts.length,3);assert.equal(f.readiness(),3)
  assert.equal(new Set(f.posts.map(p=>p.prompt['11'].inputs.filename_prefix)).size,3)
  for(const post of f.posts){
    assert.equal(post.prompt['5'].inputs.unet_name,'wan2.1_t2v_1.3B_fp16.safetensors')
    assert.deepEqual(post.prompt['7'].inputs,{width:832,height:480,length:33,batch_size:1})
  }
  assert.equal(f.assembly().totalFrames,80)
  assert.equal(f.assembly().clips.length,3)
  assert.ok(f.assembly().clips.every(p=>!existsSync(p)),'only owned intermediates removed after verified completion')
  const receipt=JSON.parse(readFileSync(join(dirname(result.path),'job.json'),'utf8'))
  assert.equal(receipt.state,'completed');assert.equal(receipt.verifiedFrameCount,80)
  assert.deepEqual([...new Set(f.progress.map(p=>p.stage))],['preparing','generating','assembling','verifying'])
  assert.ok(f.progress.every(p=>p.durationSeconds===5&&p.totalShots===3))
},{warmup:2}))

test('default is8seconds, not a replayed2secondclip',async()=>fixture(async f=>{
  const result=await f.generate(encodeNeuraleseVideoIntent('Create a video of rain.'))
  assert.equal(result.durationSeconds,8);assert.equal(f.posts.length,4);assert.equal(f.assembly().totalFrames,128)
}))

test('startup timeout and pre-submit cancellation dispatch no shot',async()=>fixture(async f=>{
  const frame=encodeNeuraleseVideoIntent('Make a 30-second video of rain.')
  await assert.rejects(f.generate(frame,{startupTimeoutMs:50}),/startup deadline/)
  const controller=new AbortController();controller.abort()
  await assert.rejects(f.generate(frame,{signal:controller.signal}),{name:'AbortError'})
  assert.equal(f.posts.length,0)
},{neverReady:true}))

for(const fallback of [false,true])test('post-submit cancellation targets only owned prompt; fallback='+fallback,async()=>fixture(async f=>{
  const controller=new AbortController()
  const pending=f.generate(encodeNeuraleseVideoIntent('Create a 30-second video of rain.'),{signal:controller.signal})
  const timer=setInterval(()=>{if(f.posts.length)controller.abort()},20)
  try{await assert.rejects(pending,{name:'AbortError'})}finally{clearInterval(timer)}
  assert.equal(f.posts.length,1);assert.deepEqual(f.cancelled,['/api/jobs/'+f.posts[0].prompt_id+'/cancel'])
  assert.deepEqual(f.queueDeletes,fallback?[{delete:[f.posts[0].prompt_id]}]:[])
  assert.equal(f.assembly(),null)
},{complete:false,cancelUnavailable:fallback}))

test('wrong assembled duration fails, preserves shots, never claims completion',async()=>fixture(async f=>{
  let clips=[]
  await assert.rejects(f.generate(encodeNeuraleseVideoIntent('Create a 3-second video.'),{
    assembleVideo:async job=>{clips=job.clips;return {frameCount:33,durationSeconds:33/16}},
  }),/did not match/)
  assert.equal(clips.length,2);assert.ok(clips.every(existsSync))
  const receipt=JSON.parse(readFileSync(join(dirname(clips[0]),'job.json'),'utf8'))
  assert.equal(receipt.state,'failed');assert.equal(receipt.completedShots,2)
}))

test('Stop during submission waits for acknowledgement then cancels the owned queued job',async()=>fixture(async f=>{
  const controller=new AbortController()
  const pending=f.generate(encodeNeuraleseVideoIntent('Make a 5-second video of rain.'),{signal:controller.signal})
  const timer=setInterval(()=>{if(f.posts.length)controller.abort()},10)
  try{await assert.rejects(pending,{name:'AbortError'})}finally{clearInterval(timer)}
  assert.equal(f.posts.length,1)
  assert.deepEqual(f.cancelled,['/api/jobs/'+f.posts[0].prompt_id+'/cancel'])
  assert.equal(f.assembly(),null)
},{ackDelayMs:100}))

test('job folder junctions are rejected before writing outside or enqueueing a shot',async()=>fixture(async f=>{
  const output=join(f.temp,'image-runtime','output'),outside=join(f.temp,'outside')
  mkdirSync(output,{recursive:true});mkdirSync(outside)
  const linked=join(output,'nori')
  symlinkSync(outside,linked,'junction')
  try{
    await assert.rejects(f.generate(encodeNeuraleseVideoIntent('Create a 5-second video.')),/junction|escapes/)
    assert.equal(f.posts.length,0)
    assert.equal(existsSync(join(outside,'jobs')),false)
  }finally{unlinkSync(linked)}
}))

