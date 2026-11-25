// One synthetic task through an already-running local Nori WebSocket bridge.
import WebSocket from 'ws'
import {writeFileSync,existsSync} from 'node:fs'
import {resolve} from 'node:path'
const revision=process.argv[2] || 'r1'
if(!/^r[0-9]+$/.test(revision))throw Error('Safe probe revision required')
const task=process.argv[3] || 'wordcraft'
if(!['wordcraft','animation'].includes(task))throw Error('Known synthetic task required')
const goal=task==='animation'
  ? 'Use EffectCraft to create a 2-second motion graphic: a blue circle moves horizontally from left to right. Add position keyframes at the start and end. Save the editable project as nori-animation-test.project. Inspect the saved animation and render previews at the start and end to verify actual motion. If animated export is unavailable, report that limitation; do not call a still image an animation.'
  : 'Use WordCraft to create a document containing NORI_ARTCRAFT_SOCKET_OK and save it as nori-socket-check.docx.'
const output=resolve(import.meta.dirname,`../../../verification/live-workspace-${task}-20261017-${revision}.json`)
if(existsSync(output))throw Error('Existing live task receipt preserved')
const start=Date.now(),frames=[],socket=new WebSocket('ws://127.0.0.1:18787',{origin:'http://127.0.0.1:15188'})
let sent=false,finished=false
const id=`nori-live-${task}-acceptance-${revision}`
const finish=(state,error)=>{
  if(finished)return;finished=true;clearTimeout(deadline);clearInterval(progress)
  const report={state,error,elapsedMs:Date.now()-start,syntheticOnly:true,request:goal,model:frames.find(frame=>frame.type==='ready')?.model,
    text:frames.filter(frame=>frame.type==='text').map(frame=>frame.delta??frame.text??'').join(''),
    events:frames.filter(frame=>['tool','error','done','neural-event'].includes(frame.type))}
  writeFileSync(output,JSON.stringify(report,null,2)+'\n',{flag:'wx'})
  console.log(JSON.stringify({phase:'completed',state,error,elapsedMs:report.elapsedMs,output}))
  socket.close();setTimeout(()=>socket.terminate(),1000).unref()
  process.exitCode=state==='done'?0:1
}
const deadline=setTimeout(()=>{socket.send(JSON.stringify({type:'interrupt'}));finish('timeout','Synthetic task exceeded four minutes')},240000)
const progress=setInterval(()=>console.log(JSON.stringify({phase:'waiting',elapsedMs:Date.now()-start,frames:frames.length})),15000)
socket.on('error',error=>finish('error',error.message))
socket.on('message',bytes=>{
  const frame=JSON.parse(bytes.toString());frames.push(frame)
  if(frame.type==='ready'&&!sent){sent=true;console.log(JSON.stringify({phase:'ready',model:frame.model}));socket.send(JSON.stringify({type:'ask',id,
    text:goal}))}
  if(frame.ask&&frame.ask!==id)return
  if(frame.type==='error')finish('error',frame.message)
  if(frame.type==='done')finish('done')
})
