import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { decodeNeuraleseVideoIntent } from '../bridge/neuralese-video-intent.mjs'
import {decodeCinematicVideoIntent} from '../bridge/cinematic-video-profile.mjs'
const resultFor = intent => {
  const {durationSeconds, totalFrames} = decodeNeuraleseVideoIntent(intent)
  return {path:'C:\\Nori-Test\\clip.mp4',mimeType:'video/mp4',size:1234,durationSeconds,frameCount:totalFrames}
}

test('native chat routes a reference-guided cinematic request and delivers its exact duration',async()=>{
  const fixture=mkdtempSync(join(tmpdir(),'nori-cinematic-query-'))
  const keys=['NORI_INFERENCE_RUNTIME','NORI_LEARNING_FILE','NORI_COMFY_URL','NORI_APP_DATA_ROOT']
  const previous=keys.map(k=>process.env[k])
  try{
    process.env.NORI_INFERENCE_RUNTIME='norllama'
    process.env.NORI_LEARNING_FILE=join(fixture,'unused-memory.json')
    process.env.NORI_COMFY_URL='http://127.0.0.1:8188'
    process.env.NORI_APP_DATA_ROOT=fixture
    const path=join(fixture,'reference.png')
    // Synthetic header qualifies routing only, not image decoding or rendering.
    writeFileSync(path,Buffer.from([137,80,78,71,13,10,26,10,0,0,0,0]))
    const {query}=await import('../bridge/nori-v2-query.mjs?cinematic-query-'+Date.now())
    async function* prompt(){yield {message:{content:`Create a 5-second cinematic video from "${path}" of deep forest roots.`}}}
    let calls=0,delivered=0;const results=[]
    for await(const frame of query({prompt:prompt(),options:{
      generateVideo:async frame=>{calls++;const i=decodeCinematicVideoIntent(frame);assert.equal(i.referencePath,path);assert.equal(i.totalFrames,120);return {path:join(fixture,'video.mp4'),mimeType:'video/mp4',size:1234,frameCount:i.totalFrames,durationSeconds:i.durationSeconds}},
      nativeVideo:async()=>{delivered++},
      nativeImage:()=>assert.fail('cinematic request was routed to still image generation'),
    }}))if(frame.type==='result')results.push(frame)
    assert.equal(calls,1);assert.equal(delivered,1)
    assert.equal(results.at(-1).subtype,'success')
    assert.match(results.at(-1).result,/5-second silent video locally/)
  }finally{
    keys.forEach((k,i)=>previous[i]===undefined?delete process.env[k]:process.env[k]=previous[i])
    rmSync(fixture,{recursive:true,force:true})
  }
})

test('native chat routes a short-video request to the local generator and delivers the result blade', async () => {
  const fixture = mkdtempSync(join(tmpdir(), 'nori-video-query-'))
  const keys = ['NORI_INFERENCE_RUNTIME', 'NORI_LEARNING_FILE', 'NORI_COMFY_URL', 'NORI_APP_DATA_ROOT']
  const previous = keys.map(key => process.env[key])
  try {
    process.env.NORI_INFERENCE_RUNTIME = 'norllama'
    process.env.NORI_LEARNING_FILE = join(fixture, 'unused-memory.json')
    process.env.NORI_COMFY_URL = 'http://127.0.0.1:8188'
    process.env.NORI_APP_DATA_ROOT = fixture
    const { query } = await import(`../bridge/nori-v2-query.mjs?native-video-query-${Date.now()}`)
    const promptText = 'Create a short video of a red WRX driving down Broadway Street in Lawrence, Massachusetts.'
    async function* prompt() { yield { message: { content: promptText } } }
    const delivered = []
    const generated = []
    const results = []
    for await (const frame of query({ prompt: prompt(), options: {
      generateVideo: async intent => { generated.push(intent); return resultFor(intent) },
      nativeVideo: async video => delivered.push(video),
      nativeImage: () => assert.fail('video generation was incorrectly routed to the still-image tool'),
    } })) if (frame.type === 'result') results.push(frame)
    assert.equal(generated.length, 1)
    assert.equal(generated[0].schema, 'nori.neuralese.video-intent.v2')
    assert.equal(generated[0].payload_cells[0][1], promptText)
    assert.equal(delivered.length, 1)
    assert.equal(delivered[0].mimeType, 'video/mp4')
    assert.equal(results.length, 1)
    assert.equal(results[0].subtype, 'success')
    assert.match(results[0].result, /8-second silent video locally/)
  } finally {
    keys.forEach((key, index) => { if (previous[index] === undefined) delete process.env[key]; else process.env[key] = previous[index] })
    rmSync(fixture, { recursive: true, force: true })
  }
})

test('video runtime capability question does not start generation', async () => {
  const fixture = mkdtempSync(join(tmpdir(), 'nori-video-capability-'))
  const keys = ['NORI_INFERENCE_RUNTIME', 'NORI_LEARNING_FILE']
  const previous = keys.map(key => process.env[key])
  try {
    process.env.NORI_INFERENCE_RUNTIME = 'norllama'
    process.env.NORI_LEARNING_FILE = join(fixture, 'unused-memory.json')
    const { query } = await import(`../bridge/nori-v2-query.mjs?video-capability-${Date.now()}`)
    async function* prompt() { yield { message: { content: 'Can you generate videos?' } } }
    let calls = 0
    const results = []
    for await (const frame of query({ prompt: prompt(), options: {
      videoHealth: async () => true,
      generateVideo: async () => { calls++; throw new Error('should not generate') },
      nativeVideo: () => assert.fail('capability question should not deliver a clip'),
    } })) if (frame.type === 'result') results.push(frame)
    assert.equal(calls, 0)
    assert.match(results[0].result, /local video generator available/)
  } finally {
    keys.forEach((key, index) => { if (previous[index] === undefined) delete process.env[key]; else process.env[key] = previous[index] })
    rmSync(fixture, { recursive: true, force: true })
  }
})

test('realism follow-up and confirmation dispatch the accumulated animated scene', async()=>{
  const fixture=mkdtempSync(join(tmpdir(),'nori-video-followup-'))
  const previous=process.env.NORI_LEARNING_FILE
  process.env.NORI_LEARNING_FILE=join(fixture,'memory.json')
  try {
    const {query}=await import(`../bridge/nori-v2-query.mjs?followup-${Date.now()}`)
    const scene='Create an animated Hallows Eve view through a window at rain and leaves falling.'
    const goals=[scene,'make it more realistic','yes do it exactly like that']
    async function* prompt(){for(const text of goals)yield {message:{content:text}}}
    const intents=[],delivered=[]
    for await(const event of query({prompt:prompt(),options:{
      generateVideo:async intent=>{intents.push(intent.payload_cells[0][1]);return resultFor(intent)},
      nativeVideo:async video=>delivered.push(video),
      nativeImage:()=>assert.fail('Animation must not produce a still image'),
    }})) {
      if(event.type==='result')assert.equal(event.subtype,'success')
    }
    assert.equal(delivered.length,3)
    assert.equal(intents.length,3)
    assert.match(intents[2],/Hallows Eve/)
    assert.match(intents[2],/make it more realistic/)
    assert.match(intents[2],/yes do it exactly like that/)
  }finally{
    if(previous===undefined)delete process.env.NORI_LEARNING_FILE;else process.env.NORI_LEARNING_FILE=previous
    rmSync(fixture,{recursive:true,force:true})
  }
})

test('requested duration and progress survive routing; shortened results cannot claim success', async()=>{
  const fixture=mkdtempSync(join(tmpdir(),'nori-video-duration-query-'))
  const previous=process.env.NORI_LEARNING_FILE
  process.env.NORI_LEARNING_FILE=join(fixture,'memory.json')
  try{
    const {query}=await import(`../bridge/nori-v2-query.mjs?duration-${Date.now()}`)
    const progress=[],delivered=[],results=[],text=[]
    async function* prompt(){yield {message:{content:'Create a 30-second video of rain.'}}}
    for await(const event of query({prompt:prompt(),options:{
      generateVideo:async(frame,options)=>{
        assert.equal(decodeNeuraleseVideoIntent(frame).totalFrames,480)
        options.onProgress({stage:'generating',completedShots:2,totalShots:15,durationSeconds:30,elapsedMs:500})
        return {...resultFor(frame),frameCount:33,durationSeconds:33/16}
      },
      nativeVideoProgress:p=>progress.push(p),nativeVideo:video=>delivered.push(video),
    }})){
      if(event.type==='result')results.push(event)
      if(event.type==='stream_event')text.push(event.event?.delta?.text)
    }
    assert.equal(progress.length,1)
    assert.match(text.join(''),/30 seconds locally using 15 new short shot/)
    assert.equal(delivered.length,0)
    assert.equal(results[0].subtype,'error_during_execution')
    assert.match(results[0].errors[0],/no shortened substitute/)
  }finally{
    if(previous===undefined)delete process.env.NORI_LEARNING_FILE;else process.env.NORI_LEARNING_FILE=previous
    rmSync(fixture,{recursive:true,force:true})
  }
})

