import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { spawn } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import WebSocket from 'ws'
process.env.NORI_INFERENCE_RUNTIME = 'norllama'
process.env.NORI_NATIVE_CORE_READY = '1'

async function probe(options, goal='*work write a file in the project') {
  const requests=[]
  const receiver=createServer(async(req,res)=>{
    let body=''; for await(const bytes of req)body+=bytes
    requests.push({url:req.url,body:JSON.parse(body||'{}')})
    res.setHeader('content-type','application/json')
    res.end(JSON.stringify({task_id:'fake-only',status:'completed',response:'FAKE_WORK_OK'}))
  })
  await new Promise(r=>receiver.listen(0,'127.0.0.1',r))
  try {
    process.env.NORI_COUNCIL_URL=`http://127.0.0.1:${receiver.address().port}`
    process.env.NORI_API_TOKEN='native-permission-test-token-more-than-thirty-two-characters'
    const {query}=await import(`../bridge/nori-v2-query.mjs?permissions=${Math.random()}`)
    async function* prompt(){yield{message:{content:goal}}}
    const results=[]
    for await(const message of query({prompt:prompt(),options}))results.push(message)
    return {requests,results}
  } finally {await new Promise(r=>receiver.close(r))}
}

for(const [name,options] of [['absent',{}],['false',{allowWrites:false}],['string',{allowWrites:'true'}]]) {
  test(`native durable work fails closed when write authorization is ${name}`,async()=>{
    const {requests,results}=await probe(options)
    assert.equal(requests.length,0,'Read-only request reached the native work receiver')
    assert.equal(results.at(-1).subtype,'error_during_execution')
    assert.match(results.at(-1).errors.join(' '),/read-only|write access/i)
  })
}
for(const goal of ['*work write a file in the project', '*capability calculate a shipping total',
  'Nori, learn how to calculate a shipping total']) {
  test(`explicit true write authorization cannot bypass unqualified native work: ${goal}`,async()=>{
    const {requests,results}=await probe({allowWrites:true},goal)
    assert.equal(requests.length,0,'Unqualified native work must not dispatch to a legacy receiver')
    assert.equal(results.at(-1).error_code,'NORI_NATIVE_TOOLS_UNQUALIFIED')
    assert.match(results.at(-1).errors.join(' '),/not passed qualification|No task was started/i)
  })
}
test('GPT-OSS capability review stays local and never reaches the durable work receiver',async()=>{
  const previous=process.env.NORI_INFERENCE_RUNTIME
  process.env.NORI_INFERENCE_RUNTIME='gpt-oss'
  try {
    const {requests,results}=await probe({allowWrites:true},'Nori, learn how to calculate a shipping total')
    assert.equal(requests.length,0,'GPT-OSS conversation mode must not start durable work')
    assert.equal(results.at(-1).error_code,'NORI_GPT_OSS_CHAT_FAILED')
    assert.match(results.at(-1).errors.join(' '),/local serving is disabled|no model substitution or cloud fallback/i)
  } finally {
    if(previous===undefined)delete process.env.NORI_INFERENCE_RUNTIME
    else process.env.NORI_INFERENCE_RUNTIME=previous
  }
})
for(const lane of ['*learn study a repository', '*improve optimize Nori',
  '*capability calculate a shipping total', 'Nori, learn how to calculate a shipping total']) {
  test(`read-only authorization also blocks ${lane.split(' ')[0]} tasks`,async()=>{
    const {requests,results}=await probe({allowWrites:false},lane)
    assert.equal(requests.length,0)
    assert.equal(results.at(-1).error_code,'NORI_READ_ONLY')
  })
}

test('read-only bridge rejects client-supplied write authorization over WebSocket', {timeout:15000}, async()=>{
  let calls=0,socket,child
  const settings=await mkdtemp(path.join(tmpdir(),'nori-read-only-test-'))
  const receiver=createServer((_req,res)=>{calls++;res.end(JSON.stringify({status:'completed',response:'unexpected'}))})
  await new Promise(r=>receiver.listen(0,'127.0.0.1',r))
  const reserve=createServer()
  await new Promise(r=>reserve.listen(0,'127.0.0.1',r))
  const port=reserve.address().port
  await new Promise(r=>reserve.close(r))
  try {
    child=spawn(process.execPath,['bridge/server.mjs'],{cwd:fileURLToPath(new URL('../',import.meta.url)),windowsHide:true,stdio:'ignore',
      env:{...process.env,NORI_INFERENCE_RUNTIME:'norllama',NORI_BRAIN:'nori-v2',NORI_LOCAL_CHAT:'0',NORI_ALLOW_WRITES:'0',
        NORI_SETTINGS_DIR:settings,NORI_BRIDGE_PORT:String(port),
        NORI_COUNCIL_URL:`http://127.0.0.1:${receiver.address().port}`,
        NORI_EVENT_BUS_URL:`http://127.0.0.1:${receiver.address().port}/publish`,
        NORI_API_TOKEN:'fake-permissions-token-more-than-thirty-two-characters'}})
    for(let i=0;i<100;i++){
      try {if((await fetch(`http://127.0.0.1:${port}/health`)).ok)break}catch{}
      await new Promise(r=>setTimeout(r,30))
    }
    const frames=[]
    socket=new WebSocket(`ws://127.0.0.1:${port}`,{origin:'http://127.0.0.1:5189'})
    socket.on('message',b=>frames.push(JSON.parse(b)))
    await new Promise((resolve,reject)=>{socket.once('open',resolve);socket.once('error',reject)})
    const waitFor=async predicate=>{
      for(let i=0;i<100;i++){const value=predicate();if(value)return value;await new Promise(r=>setTimeout(r,20))}
      assert.fail('Expected bridge frame was not received')
    }
    await waitFor(()=>frames.find(f=>f.type==='ready'))
    socket.send(JSON.stringify({type:'config',allowWrites:true}))
    socket.send(JSON.stringify({type:'ask',id:'denied',text:'*work write a file',allowWrites:true}))
    const error=await waitFor(()=>frames.find(f=>f.type==='error'))
    assert.match(error.message??error.error??'',/read-only|write access/i)
    assert.equal(calls,0,'Client authorization or legacy event publishing reached an unowned receiver')
  } finally {
    socket?.terminate();child?.kill()
    if(child&&child.exitCode===null)await new Promise(r=>child.once('exit',r))
    receiver.closeAllConnections();await new Promise(r=>receiver.close(r))
    await rm(settings,{recursive:true,force:true})
  }
})
