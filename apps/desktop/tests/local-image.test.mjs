import test from 'node:test'
import assert from 'node:assert/strict'
import {createServer} from 'node:http'
import {encodeNeuraleseImageIntent} from '../bridge/neuralese-image-intent.mjs'
const png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII='
const imageIntent=prompt=>encodeNeuraleseImageIntent(prompt)

for (const [name,item,error] of [
  ['non-image bytes',{b64_json:'aW1hZ2U='},/unsupported image format/],
  ['malformed base64',{b64_json:'%%%garbage'},/invalid image data/],
  ['remote image URL',{url:'https://example.com/image.png'},/loopback/],
]) test(`local image result rejects ${name}`,async()=>{
  const server=createServer((req,res)=>{
    res.setHeader('content-type','application/json')
    if(req.url==='/system_stats'){res.writeHead(503);res.end('{}');return}
    res.end(JSON.stringify({data:[item]}))
  })
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
  const previous=[process.env.NORI_IMAGE_API,process.env.NORI_COMFY_URL]
  try {
    process.env.NORI_IMAGE_API=process.env.NORI_COMFY_URL=`http://127.0.0.1:${server.address().port}`
    const {generateImage}=await import(`../bridge/local-image.mjs?invalid=${name}`)
    await assert.rejects(generateImage(imageIntent('test')),error)
  } finally {
    for(const [i,key] of ['NORI_IMAGE_API','NORI_COMFY_URL'].entries()){
      if(previous[i]===undefined)delete process.env[key];else process.env[key]=previous[i]
    }
    server.closeAllConnections();await new Promise(resolve=>server.close(resolve))
  }
})

test('image generation uses the local API when ComfyUI is unavailable', async()=>{
  const requests=[]
  let body
  const server=createServer((req,res)=>{
    requests.push(req.url)
    if(req.url==='/v1/images/generations'){
      const chunks=[]
      req.on('data',chunk=>chunks.push(chunk))
      req.on('end',()=>{body=JSON.parse(Buffer.concat(chunks).toString('utf8'))})
    }
    res.setHeader('content-type','application/json')
    if(req.url==='/system_stats'){res.writeHead(503);res.end('{}');return}
    res.end(JSON.stringify({data:[{b64_json:png}]}))
  })
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
  const previous=[process.env.NORI_IMAGE_API,process.env.NORI_COMFY_URL]
  try {
    process.env.NORI_IMAGE_API=process.env.NORI_COMFY_URL=`http://127.0.0.1:${server.address().port}`
    const {generateImage}=await import(`../bridge/local-image.mjs?fallback=${Date.now()}`)
    assert.deepEqual(await generateImage(imageIntent('test')),{data:png,mimeType:'image/png'})
    assert.deepEqual(requests,['/system_stats','/v1/images/generations'])
    assert.deepEqual({prompt:body.prompt,model:body.model,size:body.size},{prompt:'test',model:'z_image_turbo_int8_convrot.safetensors',size:'1024x1024'})
  } finally {
    for(const [i,key] of ['NORI_IMAGE_API','NORI_COMFY_URL'].entries()){
      if(previous[i]===undefined)delete process.env[key];else process.env[key]=previous[i]
    }
    server.closeAllConnections();await new Promise(resolve=>server.close(resolve))
  }
})

test('ComfyUI polling obeys cancellation without interrupting other jobs',async()=>{
  const requests=[]
  const server=createServer((req,res)=>{
    requests.push(req.url);res.setHeader('content-type','application/json')
    res.end(JSON.stringify({prompt_id:'test-job'}))
  })
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
  const previous=process.env.NORI_COMFY_URL
  try {
    process.env.NORI_COMFY_URL=`http://127.0.0.1:${server.address().port}`
    const {generateComfyImage}=await import(`../bridge/local-image.mjs?cancel=${Date.now()}`)
    const controller=new AbortController()
    const timer=setTimeout(()=>controller.abort(),100)
    try {await assert.rejects(generateComfyImage(imageIntent('test'),{signal:controller.signal}),{name:'AbortError'})}
    finally {clearTimeout(timer)}
    assert.ok(!requests.includes('/interrupt'))
  } finally {
    if(previous===undefined)delete process.env.NORI_COMFY_URL;else process.env.NORI_COMFY_URL=previous
    server.closeAllConnections();await new Promise(resolve=>server.close(resolve))
  }
})

test('ComfyUI uses the official Z-Image Turbo INT8 graph and returns the locally saved PNG', async()=>{
  const requests=[]
  let submitted
  const server=createServer(async(req,res)=>{
    requests.push(req.url)
    if(req.url==='/prompt'){
      const chunks=[]
      for await(const chunk of req)chunks.push(chunk)
      submitted=JSON.parse(Buffer.concat(chunks).toString('utf8')).prompt
      res.setHeader('content-type','application/json')
      res.end(JSON.stringify({prompt_id:'nori-image-test'}))
      return
    }
    if(req.url==='/history/nori-image-test'){
      res.setHeader('content-type','application/json')
      res.end(JSON.stringify({'nori-image-test':{status:{status_str:'success',completed:true},outputs:{'13':{images:[{filename:'nori-test.png',subfolder:'',type:'output'}]}}}}))
      return
    }
    if(req.url.startsWith('/view?')){
      res.setHeader('content-type','image/png')
      res.end(Buffer.from(png,'base64'))
      return
    }
    res.writeHead(404);res.end()
  })
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
  const previous=process.env.NORI_COMFY_URL
  try {
    process.env.NORI_COMFY_URL=`http://127.0.0.1:${server.address().port}`
    const {generateComfyImage}=await import(`../bridge/local-image.mjs?zimage=${Date.now()}`)
    assert.deepEqual(await generateComfyImage(encodeNeuraleseImageIntent('a violet nebula over a quiet ocean',{width:1024,height:768}),{model:'..\\outside.safetensors'}),{data:png,mimeType:'image/png'})
    assert.equal(submitted['4'].class_type,'UNETLoader')
    assert.equal(submitted['4'].inputs.unet_name,'z_image_turbo_int8_convrot.safetensors')
    assert.equal(submitted['5'].inputs.clip_name,'qwen_3_4b_fp8_mixed.safetensors')
    assert.equal(submitted['5'].inputs.type,'lumina2')
    assert.equal(submitted['6'].inputs.vae_name,'ae.safetensors')
    assert.equal(submitted['8'].inputs.text,'a violet nebula over a quiet ocean')
    assert.equal(submitted['10'].inputs.width,1024)
    assert.equal(submitted['10'].inputs.height,768)
    assert.equal(submitted['11'].inputs.steps,8)
    assert.equal(requests[0],'/prompt')
    assert.ok(requests.includes('/history/nori-image-test'))
    assert.ok(requests.some(path=>path.startsWith('/view?')))
  } finally {
    if(previous===undefined)delete process.env.NORI_COMFY_URL;else process.env.NORI_COMFY_URL=previous
    server.closeAllConnections();await new Promise(resolve=>server.close(resolve))
  }
})

test('managed image generation waits for packaged ComfyUI before submitting a prompt', async()=>{
  let healthChecks=0
  const requests=[]
  const server=createServer(async(req,res)=>{
    requests.push(req.url)
    if(req.url==='/system_stats'){
      healthChecks++
      res.writeHead(healthChecks < 3 ? 503 : 200, {'content-type':'application/json'})
      res.end('{}')
      return
    }
    if(req.url==='/prompt'){
      res.setHeader('content-type','application/json')
      res.end(JSON.stringify({prompt_id:'managed-image-test'}))
      return
    }
    if(req.url==='/history/managed-image-test'){
      res.setHeader('content-type','application/json')
      res.end(JSON.stringify({'managed-image-test':{status:{status_str:'success',completed:true},outputs:{'13':{images:[{filename:'managed.png',type:'output'}]}}}}))
      return
    }
    if(req.url.startsWith('/view?')){res.setHeader('content-type','image/png');res.end(Buffer.from(png,'base64'));return}
    res.writeHead(404);res.end('{}')
  })
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
  const previous=[process.env.NORI_IMAGE_API,process.env.NORI_COMFY_URL,process.env.NORI_COMFY_RUNTIME_MANAGED]
  try {
    process.env.NORI_IMAGE_API=process.env.NORI_COMFY_URL=`http://127.0.0.1:${server.address().port}`
    process.env.NORI_COMFY_RUNTIME_MANAGED='1'
    const {generateImage}=await import(`../bridge/local-image.mjs?managed-ready=${Date.now()}`)
    assert.deepEqual(await generateImage(imageIntent('a red car'),{comfyStartupTimeoutMs:1000,comfyPollIntervalMs:10}),
      {data:png,mimeType:'image/png'})
    assert.ok(healthChecks >= 3)
    assert.ok(requests.includes('/prompt'))
    assert.ok(!requests.includes('/v1/images/generations'))
  } finally {
    for(const [i,key] of ['NORI_IMAGE_API','NORI_COMFY_URL','NORI_COMFY_RUNTIME_MANAGED'].entries()){
      if(previous[i]===undefined)delete process.env[key];else process.env[key]=previous[i]
    }
    server.closeAllConnections();await new Promise(resolve=>server.close(resolve))
  }
})

test('managed image generation reports a bundled-runtime readiness failure clearly', async()=>{
  const server=createServer((req,res)=>{res.writeHead(503,{'content-type':'application/json'});res.end('{}')})
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
  const previous=[process.env.NORI_IMAGE_API,process.env.NORI_COMFY_URL,process.env.NORI_COMFY_RUNTIME_MANAGED]
  try {
    process.env.NORI_IMAGE_API=process.env.NORI_COMFY_URL=`http://127.0.0.1:${server.address().port}`
    process.env.NORI_COMFY_RUNTIME_MANAGED='1'
    const {generateImage}=await import(`../bridge/local-image.mjs?managed-timeout=${Date.now()}`)
    await assert.rejects(generateImage(imageIntent('a red car'),{comfyStartupTimeoutMs:30,comfyPollIntervalMs:5}),
      /bundled image runtime did not become ready within 30 ms/)
  } finally {
    for(const [i,key] of ['NORI_IMAGE_API','NORI_COMFY_URL','NORI_COMFY_RUNTIME_MANAGED'].entries()){
      if(previous[i]===undefined)delete process.env[key];else process.env[key]=previous[i]
    }
    server.closeAllConnections();await new Promise(resolve=>server.close(resolve))
  }
})
