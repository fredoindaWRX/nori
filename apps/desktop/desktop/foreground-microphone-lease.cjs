const {spawn}=require('node:child_process')
const fs=require('node:fs')
const path=require('node:path')

// Cooperative Nori foreground reservation; no audio capture and no startup writes.
async function acquireForegroundMicrophoneLease(root,{onLost=()=>{}}={}){
  if(typeof onLost!=='function')throw Error('Invalid microphone lease observer')
  root=fs.realpathSync(root)
  const executable=fs.realpathSync(path.join(root,'runtime/wake/nori-microphone.exe'))
  const delta=path.relative(root,executable)
  if(delta==='..'||delta.startsWith('..'+path.sep)||path.isAbsolute(delta)||!fs.statSync(executable).isFile())
    throw Error('Microphone lease helper escapes Nori')
  const child=spawn(executable,['--lease-only'],{cwd:root,shell:false,windowsHide:true,stdio:['pipe','pipe','ignore']})
  let readyResolve,readyReject,buffer='',ack=false,stopping
  const ready=new Promise((resolve,reject)=>{readyResolve=resolve;readyReject=reject})
  const exited=new Promise(resolve=>child.once('close',()=>resolve(true)))
  const fail=()=>readyReject(Error('Foreground microphone reservation unavailable'))
  child.once('error',fail);child.stdin.on('error',fail)
  child.stdout.on('data',chunk=>{
    buffer+=chunk.toString('utf8')
    if(buffer.length>512){fail();child.stdin.end();return}
    if(!buffer.includes('\n'))return
    try{
      const record=JSON.parse(buffer)
      if(ack||Object.keys(record).sort().join(',')!=='capture_started,microphone_lease,schema'||
        record.schema!==1||record.microphone_lease!==true||record.capture_started!==false)throw Error()
      ack=true;readyResolve()
    }catch{fail();child.stdin.end()}
  })
  exited.then(()=>{fail();if(ack&&!stopping)onLost()})
  const stop=()=>{
    if(stopping)return stopping
    stopping=(async()=>{
      child.stdin.end()
      let timer
      let result=await Promise.race([exited,new Promise(resolve=>{timer=setTimeout(()=>resolve(false),2000)})])
      clearTimeout(timer)
      if(!result){child.kill();result=await Promise.race([exited,new Promise(resolve=>{timer=setTimeout(()=>resolve(false),2000)})]);clearTimeout(timer)}
      if(!result)throw Error('Foreground microphone lease exit not confirmed')
      return true
    })()
    return stopping
  }
  const timer=setTimeout(fail,7000)
  try{await ready}catch(error){await stop();throw error}finally{clearTimeout(timer)}
  return {stop}
}
module.exports={acquireForegroundMicrophoneLease}
