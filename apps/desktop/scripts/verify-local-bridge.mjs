/** Real local-only integration probe. No downloads, capture or task-worker dispatch. */
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { spawn } from 'node:child_process'
import { mkdtemp, writeFile } from 'node:fs/promises'
import path from 'node:path'
import WebSocket from 'ws'

const settings = await mkdtemp(path.resolve('local-bridge-probe-'))
const reserve=createServer()
await new Promise(r=>reserve.listen(0,'127.0.0.1',r))
const port=reserve.address().port
await new Promise(r=>reserve.close(r))
const child=spawn(process.execPath,['bridge/server.mjs'],{cwd:process.cwd(),windowsHide:true,
  env:{...process.env,NORI_BRAIN:'nori-v2',NORI_LOCAL_CHAT:'1',NORI_BRIDGE_PORT:String(port),
    NORI_SETTINGS_DIR:settings,NORI_ROOT:'C:/Nori',NORI_ALLOW_WRITES:'0',
    NORI_OLLAMA_URL:'http://127.0.0.1:11434',NORI_DEFAULT_MODEL:'qwen3.5:4b',
    NORI_API_TOKEN:'isolated-local-chat-probe-no-council-request',
    NORI_PYTHON:'C:/Users/Studio/AppData/Local/Programs/Python/Python311/python.exe',
    PYTHONDONTWRITEBYTECODE:'1',HF_HUB_OFFLINE:'1',TRANSFORMERS_OFFLINE:'1'},
  stdio:['ignore','pipe','pipe']})
let logs='',socket
child.stdout.on('data',b=>{logs=(logs+b).slice(-12000)})
child.stderr.on('data',b=>{logs=(logs+b).slice(-12000)})
const start=Date.now(),frames=[]
const until=async(predicate,timeout=15000)=>{
  const end=Date.now()+timeout
  while(Date.now()<end){const result=predicate();if(result)return result;await new Promise(r=>setTimeout(r,50))}
  throw Error('Expected local bridge evidence did not arrive within timeout')
}
try {
  let health
  for(let i=0;i<150;i++){
    try {const r=await fetch(`http://127.0.0.1:${port}/health`);if(r.ok){health=await r.json();break}}catch{}
    if(child.exitCode!==null)throw Error('Bridge exited before becoming ready')
    await new Promise(r=>setTimeout(r,100))
  }
  assert.equal(health?.localOnly,true)
  socket=new WebSocket(`ws://127.0.0.1:${port}`,{origin:'http://127.0.0.1:5189'})
  socket.on('message',b=>frames.push({...JSON.parse(b),receivedAt:Date.now()}))
  await new Promise((resolve,reject)=>{socket.once('open',resolve);socket.once('error',reject)})
  const ready=await until(()=>frames.find(f=>f.type==='ready'))
  socket.send(JSON.stringify({type:'config',effort:'lightning-fast',model:'qwen3.5:4b'}))
  await until(()=>frames.find(f=>f.type==='ready'&&f.model==='qwen3.5:4b'&&f.effort==='lightning-fast'))
  const sentAt=Date.now()
  socket.send(JSON.stringify({type:'ask',id:'real-local-one',text:'Reply with one short sentence: what is two plus two?'}))
  const done=await until(()=>frames.find(f=>f.type==='done'),90000)
  const text=frames.filter(f=>f.type==='text').map(f=>f.delta??f.text??'').join('')
  assert.ok(text.trim(),'No streamed local response')
  assert.doesNotMatch(text,/not installed|missing|cloud request|connection refused/i)
  assert.ok(/four|\b4\b/i.test(text),'Unexpected arithmetic smoke response')
  const first=frames.find(f=>f.type==='text'&&(f.delta||f.text))
  const secondStart=frames.length,secondSentAt=Date.now()
  socket.send(JSON.stringify({type:'ask',id:'real-local-two',text:'What answer did you just give me? Reply in one short sentence.'}))
  const secondDone=await until(()=>frames.slice(secondStart).find(f=>f.type==='done'),90000)
  const secondFrames=frames.slice(secondStart)
  const secondText=secondFrames.filter(f=>f.type==='text').map(f=>f.delta??f.text??'').join('')
  assert.ok(/four|\b4\b/i.test(secondText),'The real follow-up lost the previous answer')
  const secondFirst=secondFrames.find(f=>f.type==='text'&&(f.delta||f.text))
  const configStart=frames.length
  socket.send(JSON.stringify({type:'config',effort:'balanced'}))
  await until(()=>frames.slice(configStart).find(f=>f.type==='ready'&&f.effort==='balanced'))
  const deepConfigStart=frames.length
  socket.send(JSON.stringify({type:'config',effort:'deep',model:'qwen3.5:4b'}))
  await until(()=>frames.slice(deepConfigStart).find(f=>f.type==='ready'&&f.effort==='deep'&&f.model==='qwen3.5:4b'))
  const thirdStart=frames.length,thirdSentAt=Date.now()
  socket.send(JSON.stringify({type:'ask',id:'real-local-three',text:'What was the arithmetic answer from our conversation? Reply with only the number.'}))
  const thirdDone=await until(()=>frames.slice(thirdStart).find(f=>f.type==='done'),90000)
  const thirdFrames=frames.slice(thirdStart)
  const thirdText=thirdFrames.filter(f=>f.type==='text').map(f=>f.delta??f.text??'').join('')
  assert.ok(/\b4\b/.test(thirdText),'The deep-profile follow-up lost conversation context')
  assert.equal(thirdFrames.some(f=>f.type==='error'),false,'The style change produced a bridge error')
  const report={kind:'nori-real-local-bridge-probe',observedAt:new Date().toISOString(),
    localOnly:health.localOnly,model:'qwen3.5:4b',effort:'lightning-fast',
    streamedResponse:text,firstTextMs:first.receivedAt-sentAt,turnMs:done.receivedAt-sentAt,
    warmFollowupResponse:secondText,warmFirstTextMs:secondFirst.receivedAt-secondSentAt,
    warmTurnMs:secondDone.receivedAt-secondSentAt,contextRetained:true,balancedConfigAcknowledged:true,
    deepConfigAcknowledged:true,deepFollowupResponse:thirdText,deepTurnMs:thirdDone.receivedAt-thirdSentAt,
    contextRetainedAfterStyleChange:true,
    totalMs:Date.now()-start,sttReady:health.stt,ttsReady:health.tts,
    initialModel:ready.model,settingsCandidate:path.basename(settings),passed:true,
    limitations:['Three real local chat turns including deep-profile context retention and balanced/deep acknowledgements; no Council action, image, speech or capture tested.']}
  await writeFile(path.resolve('LOCAL_BRIDGE_PROBE_RECEIPT.json'),JSON.stringify(report,null,2))
  console.log(JSON.stringify(report))
} catch(error) {
  console.error(error.message)
  console.error(logs.replace(/isolated-local-chat-probe-no-council-request/g,'[test credential]'))
  process.exitCode=1
} finally {
  socket?.terminate()
  child.kill()
  if(child.exitCode===null)await new Promise(r=>child.once('exit',r))
}
