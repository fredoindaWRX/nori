import test from 'node:test'
import assert from 'node:assert/strict'
import {spawn} from 'node:child_process'
import {mkdtemp,rm,readdir,readFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createServer,createConnection} from 'node:net'
import {createServer as createHttpServer} from 'node:http'
import {fileURLToPath} from 'node:url'
import WebSocket from 'ws'

test('real bridge delivers owned neural events for model-free requests across reconnect', {timeout:15000},async t=>{
  const root=await mkdtemp(join(tmpdir(),'nori-neural-ws-'))
  const reservation=createServer()
  await new Promise(resolve=>reservation.listen(0,'127.0.0.1',resolve))
  const port=reservation.address().port
  await new Promise(resolve=>reservation.close(resolve))
  let releaseOld=null
  let holdNext=false
  let abortedResponses=0
  let inferenceRequests=0
  const inference=createHttpServer(async(request,response)=>{
    assert.equal(request.url,'/v1/chat')
    assert.equal(request.headers.authorization,'Bearer synthetic-native-token')
    for await(const chunk of request) {}
    inferenceRequests++
    const answer=inferenceRequests===1?'OBSOLETE_SYNTHETIC_RESPONSE':'CURRENT_SYNTHETIC_RESPONSE'
    const finish=()=>{
      response.writeHead(200,{'content-type':'text/event-stream'})
      response.end(`event: token\ndata: ${JSON.stringify({text:answer})}\n\nevent: done\ndata: [DONE]\n\n`)
    }
    if(inferenceRequests===1 || holdNext){
      holdNext=false
      response.once('close',()=>{if(!response.writableEnded)abortedResponses++})
      releaseOld=finish
    }
    else finish()
  })
  await new Promise(resolve=>inference.listen(0,'127.0.0.1',resolve))
  const child=spawn(process.execPath,[fileURLToPath(new URL('../bridge/server.mjs',import.meta.url))],{
    cwd:fileURLToPath(new URL('..',import.meta.url)),
    env:{...process.env,NORI_ROOT:root,NORI_SETTINGS_DIR:join(root,'settings'),NORI_LEARNING_FILE:join(root,'guidance.json'),
      NORI_BRIDGE_PORT:String(port),NORI_BRAIN:'nori-v2',NORI_INFERENCE_RUNTIME:'norllama',NORI_ALLOW_WRITES:'0',
      NORI_ALLOWED_ORIGINS:'http://127.0.0.1:5173',NORI_PYTHON:'',NORI_WORKSPACE:'',
      NORI_RUNTIME_URL:`http://127.0.0.1:${inference.address().port}`,NORI_RUNTIME_API_KEY:'synthetic-native-token',NORI_RUNTIME_MODEL_ID:'synthetic-owned-model'},
    stdio:['ignore','pipe','pipe'],windowsHide:true,
  })
  let logs=''
  const sockets=[]
  t.after(async()=>{
    for(const socket of sockets)socket.terminate()
    inference.closeAllConnections()
    await new Promise(resolve=>inference.close(resolve))
    if(child.exitCode===null) {
      const exited=new Promise(resolve=>child.once('exit',resolve))
      child.kill()
      await exited
    }
    await rm(root,{recursive:true,force:true})
  })
  await new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>reject(Error('Bridge startup timed out')),6000)
    child.stdout.on('data',data=>{logs+=data; if(logs.includes('bridge listening')){clearTimeout(timer);resolve()}})
    child.stderr.on('data',data=>{logs+=data})
    child.once('exit',code=>{clearTimeout(timer);reject(Error(`Bridge exited ${code}: ${logs.slice(-1200)}`))})
  })
  const listenDeadline=Date.now()+4000
  while(true){
    const listening=await new Promise(resolve=>{
      const probe=createConnection({host:'127.0.0.1',port})
      probe.once('connect',()=>{probe.destroy();resolve(true)})
      probe.once('error',()=>{probe.destroy();resolve(false)})
    })
    if(listening)break
    assert.ok(Date.now()<listenDeadline,`Bridge did not bind: ${logs.slice(-1200)}`)
    await new Promise(resolve=>setTimeout(resolve,20))
  }
  async function connect(){
    const socket=new WebSocket(`ws://127.0.0.1:${port}/ws`,{origin:'http://127.0.0.1:5173'})
    sockets.push(socket)
    const frames=[]
    socket.on('message',data=>frames.push(JSON.parse(String(data))))
    await new Promise((resolve,reject)=>{socket.once('open',resolve);socket.once('error',reject)})
    return {socket,frames}
  }
  async function ask(connection,id){
    connection.socket.send(JSON.stringify({type:'ask',id,text:'Turn the interface ghost purple.'}))
    const deadline=Date.now()+4000
    while(!connection.frames.some(frame=>frame.type==='done'&&frame.ask===id)){
      assert.ok(Date.now()<deadline,`No deterministic completion: ${JSON.stringify(connection.frames)}`)
      await new Promise(resolve=>setTimeout(resolve,15))
    }
    const events=connection.frames.filter(frame=>frame.type==='neural-event'&&frame.ask===id)
    assert.deepEqual(events.map(event=>event.state),['started','completed'])
    assert.ok(events.every(event=>event.operation==='memory_recall'))
    return events
  }
  const initial=await connect()
  const first=await ask(initial,'reused-id')
  initial.socket.send(JSON.stringify({type:'interrupt'}))
  initial.socket.close()
  await new Promise(resolve=>initial.socket.once('close',resolve))
  const restarted=await connect()
  const second=await ask(restarted,'reused-id')
  assert.notEqual(first[0].operation_id,second[0].operation_id)
  assert.ok(!JSON.stringify(second).includes('Turn the interface'))
  const queued=await connect()
  for(const id of ['queued-old','queued-current'])queued.socket.send(JSON.stringify({
    type:'ask',id,text:'Turn the interface ghost purple.',
  }))
  const queuedDeadline=Date.now()+4000
  while(!queued.frames.some(frame=>frame.type==='done'&&frame.ask==='queued-current')){
    assert.ok(Date.now()<queuedDeadline,`Queued requests did not finish: ${JSON.stringify(queued.frames)}`)
    await new Promise(resolve=>setTimeout(resolve,15))
  }
  // A subsequent completed request proves the sequential adapter drained both
  // preceding requests before we inspect their final frame counts.
  await ask(queued,'drain-barrier')
  assert.equal(queued.frames.filter(frame=>frame.type==='ui').length,2,
    'only the current queued request and drain barrier may update the UI')
  const queuedEvents=queued.frames.filter(frame=>frame.type==='neural-event'&&frame.ask!=='drain-barrier')
  const operations=new Map()
  for(const event of queuedEvents){
    const prior=operations.get(event.operation_id)
    if(prior)assert.equal(event.ask,prior,'one operation must never change request ownership')
    operations.set(event.operation_id,event.ask)
    assert.ok(['queued-old','queued-current'].includes(event.ask))
  }
  const currentEvents=queuedEvents.filter(event=>event.ask==='queued-current')
  assert.deepEqual(currentEvents.map(event=>event.state),['started','completed'])
  assert.equal(new Set(currentEvents.map(event=>event.operation_id)).size,1,
    'superseded operation must not be rebound to the current request')
  assert.equal(queued.frames.filter(frame=>frame.type==='done'&&frame.ask==='queued-current').length,1,
    'old completion must not be relabeled as the current request')
  const currentText=queued.frames.filter(frame=>frame.type==='text'&&frame.ask==='queued-current')
  assert.equal(currentText.map(frame=>frame.delta).join(''),'Done.',
    'old response text must not be appended to the current request')
  const records=(await readdir(join(root,'settings'))).filter(name=>/^resume-native-.*\.json$/.test(name))
  assert.equal(records.length,1)
  const saved=JSON.parse(await readFile(join(root,'settings',records[0]),'utf8'))
  assert.equal(saved.history.length,8,
    'four active completed requests persist; superseded queued request adds no history pair')
  assert.equal(saved.history.filter(turn=>turn.role==='user').length,4)
  assert.equal(saved.history.filter(turn=>turn.role==='nori').length,4)
  const delayed=await connect()
  delayed.socket.send(JSON.stringify({type:'ask',id:'delayed-old',text:'Hello delayed fixture'}))
  const inferenceDeadline=Date.now()+4000
  while(!releaseOld){
    assert.ok(Date.now()<inferenceDeadline,'Synthetic inference request not received')
    await new Promise(resolve=>setTimeout(resolve,15))
  }
  delayed.socket.send(JSON.stringify({type:'ask',id:'delayed-current',text:'Hello second fixture'}))
  await new Promise(resolve=>setTimeout(resolve,30))
  releaseOld()
  const delayedDeadline=Date.now()+4000
  while(!delayed.frames.some(frame=>frame.type==='done'&&frame.ask==='delayed-current')){
    assert.ok(Date.now()<delayedDeadline,`Delayed reply did not finish: ${JSON.stringify(delayed.frames)}`)
    await new Promise(resolve=>setTimeout(resolve,15))
  }
  await ask(delayed,'stream-drain-barrier')
  assert.equal(inferenceRequests,2)
  assert.ok(!JSON.stringify(delayed.frames).includes('OBSOLETE_SYNTHETIC_RESPONSE'))
  assert.equal(delayed.frames.filter(frame=>frame.type==='text'&&frame.ask==='delayed-current').map(frame=>frame.delta).join(''),'CURRENT_SYNTHETIC_RESPONSE')
  assert.equal(delayed.frames.filter(frame=>frame.type==='done'&&frame.ask==='delayed-current').length,1)
  const interrupted=await connect()
  holdNext=true
  releaseOld=null
  interrupted.socket.send(JSON.stringify({type:'ask',id:'interrupt-old',text:'Hello held fixture'}))
  const heldDeadline=Date.now()+4000
  while(!releaseOld){
    assert.ok(Date.now()<heldDeadline,'Held interruption fixture was not reached')
    await new Promise(resolve=>setTimeout(resolve,15))
  }
  interrupted.socket.send(JSON.stringify({type:'interrupt'}))
  await ask(interrupted,'after-interrupt')
  assert.ok(abortedResponses>=1,'Interrupt must close the held HTTP response')
  releaseOld()
  await ask(interrupted,'interrupt-drain-barrier')
  assert.ok(!interrupted.frames.some(frame=>['text','done'].includes(frame.type)&&frame.ask==='interrupt-old'))
  assert.equal(interrupted.frames.filter(frame=>frame.type==='text'&&frame.ask==='after-interrupt').map(frame=>frame.delta).join(''),'Done.')
  assert.equal(inferenceRequests,3)
})
