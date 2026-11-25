import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { spawn } from 'node:child_process'
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {fileURLToPath} from 'node:url'
import WebSocket from 'ws'
import { RESPONSE_INSTRUCTIONS } from '../bridge/response-profiles.mjs'

test('response style does not assume a user name', () => {
  assert.match(RESPONSE_INSTRUCTIONS['lightning-fast'], /expand when asked/)
  assert.doesNotMatch(RESPONSE_INSTRUCTIONS['lightning-fast'], /\bWill\b/)
})

test('adult companion requires explicit opt-in and keeps device access out of style policy', () => {
  const instruction = RESPONSE_INSTRUCTIONS['adult-companion']
  assert.match(instruction, /user selecting it and confirming they are 18\+/)
  assert.match(instruction, /clearly 18\+ and consenting/)
  assert.match(instruction, /Respect requests to stop or change tone immediately/)
  assert.match(instruction, /grants no device, camera, microphone, network, or other tool access/)
  assert.doesNotMatch(RESPONSE_INSTRUCTIONS.balanced, /adult companion/i)
})

test('native response style applies immediately, preserves the live conversation, and survives reconnect', { timeout: 60000 }, async t => {
  const settings=mkdtempSync(join(tmpdir(),'nori-profile-test-'))
  const requests=[]
  const runtime=createServer(async(req,res)=>{
    if(req.method==='GET'&&req.url==='/health'){
      res.setHeader('content-type','application/json')
      res.end(JSON.stringify({ready:true,backend:'norama-independent',model_id:'fixture-bridge',
        imported_weights:true,nori_trained_model:false}))
      return
    }
    assert.equal(req.method,'POST')
    assert.equal(req.url,'/v1/chat')
    let raw=''; for await(const chunk of req) raw+=chunk
    requests.push(JSON.parse(raw))
    res.setHeader('content-type','text/event-stream')
    res.end('event: token\ndata: {"text":"The remembered project is Apollo."}\n\nevent: done\ndata: [DONE]\n\n')
  })
  await new Promise(r=>runtime.listen(0,'127.0.0.1',r))
  const reserve=createServer()
  await new Promise(r=>reserve.listen(0,'127.0.0.1',r))
  const port=reserve.address().port
  await new Promise(r=>reserve.close(r))
  const child=spawn(process.execPath,['bridge/server.mjs'],{
    cwd:fileURLToPath(new URL('../',import.meta.url)), windowsHide:true,
    env:{...process.env,NORI_BRAIN:'nori-v2',NORI_INFERENCE_RUNTIME:'norllama',NORI_LOCAL_CHAT:'0',NORI_ALLOW_WRITES:'1',NORI_BRIDGE_PORT:String(port),NORI_SETTINGS_DIR:settings,
      NORI_RUNTIME_URL:`http://127.0.0.1:${runtime.address().port}`,
      NORI_RUNTIME_API_KEY:'fixture-native-runtime-key-long-enough-for-tests',
      NORI_RUNTIME_MODEL_ID:'fixture-bridge',
      NORI_API_TOKEN:'profile-test-token-longer-than-thirty-two-characters'},
    stdio:['ignore','pipe','pipe'],
  })
  let logs=''; child.stdout.on('data',b=>{logs+=b}); child.stderr.on('data',b=>{logs+=b})
  const sockets=[]
  t.after(async()=>{
    for(const socket of sockets) socket.terminate()
    child.kill()
    await new Promise(r=>{if(child.exitCode!==null)r();else child.once('exit',r)})
    runtime.closeAllConnections(); await new Promise(r=>runtime.close(r))
    rmSync(settings,{recursive:true,force:true})
  })
  const connect=()=>new Promise((resolve,reject)=>{
    const socket=new WebSocket(`ws://127.0.0.1:${port}`, { origin:'http://127.0.0.1:5188' })
    const frames=[]
    sockets.push(socket)
    socket.on('message',b=>frames.push(JSON.parse(b)))
    socket.once('error',reject)
    socket.once('open',()=>resolve({socket,frames}))
  })
  let client
  for(let i=0;i<100;i++){
    try{client=await connect();break}catch{await new Promise(r=>setTimeout(r,50))}
  }
  assert.ok(client,logs)
  const until=async (predicate,message='bridge event',timeoutMs=3000)=>{
    const deadline=Date.now()+timeoutMs
    while(Date.now()<deadline){const value=predicate();if(value)return value;await new Promise(r=>setTimeout(r,20))}
    assert.fail(`Expected ${message} missing. ${logs}`)
  }
  // The server sends an immediate provisional ready frame before the query
  // adapter has attached its input iterator. Wait for the real query init frame
  // so this test cannot race the WebSocket message-handler setup.
  await until(()=>client.frames.find(f=>f.type==='ready'&&f.servers.includes('nori-v2')))
  await new Promise(resolve=>setImmediate(resolve))
  client.socket.send(JSON.stringify({type:'ask',text:'What are the tradeoffs in project Apollo?',id:'one'}))
  await until(()=>requests.length===1,'local chat request',25000)
  await until(()=>client.frames.find(f=>f.type==='done'))
  const previousReady=client.frames.filter(f=>f.type==='ready').length
  client.socket.send(JSON.stringify({type:'config',effort:'adult-companion'}))
  await until(()=>client.frames.filter(f=>f.type==='ready').length>previousReady)
  assert.equal(client.socket.readyState,WebSocket.OPEN)
  assert.equal(client.frames.filter(f=>f.type==='ready').at(-1).effort,'adult-companion')
  client.socket.send(JSON.stringify({type:'ask',text:'Explain its tradeoffs.',id:'two'}))
  await until(()=>requests.length===2,'second local chat request',25000)
  assert.equal(requests[0].conversation_id,requests[1].conversation_id)
  assert.match(requests[0].messages[0].content,/Answer directly in a few short sentences/)
  assert.match(requests[1].messages[0].content,/Optional adult companion style/)
  assert.match(requests[1].messages[0].content,/grants no device, camera, microphone, network, or other tool access/)
  assert.ok(requests[1].messages.some(message=>message.role==='assistant'&&message.content==='The remembered project is Apollo.'),
    'Native local follow-up should retain the prior assistant answer')
  assert.ok(requests[1].messages.some(message=>message.role==='user'&&message.content==='Explain its tradeoffs.'),
    'Native local follow-up should preserve the newest user request')
  await until(()=>readdirSync(settings).length)
  const saved=JSON.parse(readFileSync(join(settings,readdirSync(settings)[0]),'utf8'))
  assert.equal(saved.effort,'adult-companion')
  client.socket.close()
  const reconnected=await connect()
  const ready=await until(()=>reconnected.frames.find(f=>f.type==='ready'))
  assert.equal(ready.effort,'adult-companion')
  reconnected.socket.send(JSON.stringify({type:'config',effort:'balanced'}))
  await until(()=>reconnected.frames.find(f=>f.type==='ready'&&f.effort==='balanced'))
  reconnected.socket.send(JSON.stringify({type:'ask',text:'How should we start?',id:'three'}))
  await until(()=>requests.length===3,'third local chat request',25000)
  assert.match(requests[2].messages[0].content,/Give a clear answer with enough useful context/)
  reconnected.socket.send(JSON.stringify({type:'config',effort:'invalid-profile'}))
  await new Promise(r=>setTimeout(r,30))
  assert.equal(reconnected.frames.filter(f=>f.type==='ready').at(-1).effort,'balanced')
  const modelCallsBeforeUnqualifiedWork=requests.length
  reconnected.socket.send(JSON.stringify({type:'ask',text:'*work Compare Apollo rollout choices.',id:'four'}))
  const blocked=await until(()=>reconnected.frames.find(frame=>frame.ask==='four'&&frame.type==='error'),'unqualified tool refusal')
  assert.match(blocked.message,/Core\/Knights tool routing is not connected yet/)
  assert.equal(requests.length,modelCallsBeforeUnqualifiedWork,
    'A work task must not be sent to the chat model while tool execution remains unqualified')
})
