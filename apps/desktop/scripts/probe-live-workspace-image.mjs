// One synthetic image request through the actual running desktop bridge.
import WebSocket from 'ws'
import {writeFileSync,existsSync} from 'node:fs'
import {resolve} from 'node:path'
const output=resolve(import.meta.dirname,'../../../verification/live-workspace-image-20261017-r1.json')
if(existsSync(output))throw Error('Existing receipt preserved')
const start=Date.now(),frames=[],socket=new WebSocket('ws://127.0.0.1:18787',{origin:'http://127.0.0.1:15188'})
const id='nori-live-image-acceptance-r1'
let sent=false,finished=false
function finish(state,error){
  if(finished)return;finished=true;clearTimeout(deadline);clearInterval(progress)
  const report={state,error,elapsedMs:Date.now()-start,syntheticOnly:true,
    events:frames.filter(frame=>['error','done','neural-event'].includes(frame.type))}
  writeFileSync(output,JSON.stringify(report,null,2)+'\n',{flag:'wx'})
  console.log(JSON.stringify({state,error,elapsedMs:report.elapsedMs,output}))
  socket.close();setTimeout(()=>socket.terminate(),1000).unref();process.exitCode=state==='done'?0:1
}
const deadline=setTimeout(()=>{socket.send(JSON.stringify({type:'interrupt'}));finish('timeout','Synthetic image turn exceeded four minutes')},240000)
const progress=setInterval(()=>console.log(JSON.stringify({phase:'waiting',elapsedMs:Date.now()-start,frames:frames.length})),15000)
socket.on('error',error=>finish('error',error.message))
socket.on('message',bytes=>{
  const frame=JSON.parse(bytes.toString());frames.push(frame)
  if(frame.type==='ready'&&!sent){sent=true;socket.send(JSON.stringify({type:'ask',id,
    text:'Generate a photorealistic image of a red Honda del Sol parked in a clean sunlit workshop, front three-quarter view, no text.'}))}
  if(frame.ask&&frame.ask!==id)return
  if(frame.type==='error')finish('error',frame.message)
  if(frame.type==='done')finish('done')
})
