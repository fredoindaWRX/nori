const {spawn}=require('node:child_process')
const {realpathSync,statSync}=require('node:fs')
const {join,relative,isAbsolute}=require('node:path')
const {createMicrophoneRing}=require('./microphone-ring.cjs')
const {createMicrophoneWatchdog}=require('./microphone-watchdog.cjs')

async function startStreamingMicrophone(root){
  root=realpathSync(root)
  const executable=realpathSync(join(root,'runtime/wake/nori-microphone.exe'))
  const delta=relative(root,executable)
  if(delta.startsWith('..')||isAbsolute(delta)||!statSync(executable).isFile())throw Error('Microphone escapes Nori')
  const child=spawn(executable,['--listen'],{cwd:root,windowsHide:true,shell:false,stdio:['pipe','pipe','ignore']})
  const ring=createMicrophoneRing()
  let buffer=Buffer.alloc(0),format=false,ended=false,failed=false,closed=false,stopping,pending,lastDelivered=0,failureError
  let readyResolve,readyReject
  const ready=new Promise((resolve,reject)=>{readyResolve=resolve;readyReject=reject})
  const exited=new Promise(resolve=>{
    child.once('close',(code,signal)=>{closed=true;resolve({code,signal})})
  })
  const fail=(error=Error('Streaming microphone failed'))=>{
    if(failed)return
    failed=true;failureError=error;readyReject(error)
    watchdog.stop()
    pending?.reject(error);pending=null
    child.stdin.end()
  }
  const watchdog=createMicrophoneWatchdog(fail)
  child.on('error',fail);child.stdin.on('error',fail)
  exited.then(({code})=>{
    if(!stopping)fail(code===10
      ? Object.assign(Error('Microphone yielded to foreground Nori'),{code:'NORI_MICROPHONE_YIELDED'})
      : code===20 ? Object.assign(Error('Foreground Nori owns microphone'),{code:'NORI_MICROPHONE_BUSY'})
      : Error('Streaming microphone failed'))
  })
  const deliver=()=>{
    if(pending&&ring.total()>=pending.threshold){
      const request=pending;pending=null;lastDelivered=ring.total()
      request.resolve(ring.snapshot(request.bytes))
    }
  }
  child.stdout.on('data',chunk=>{
    if(failed)return
    buffer=Buffer.concat([buffer,chunk])
    if(buffer.length>131072){fail();return}
    if(!format){
      const newline=buffer.indexOf(10)
      if(newline<0){if(buffer.length>512)fail();return}
      try{
        const record=JSON.parse(buffer.subarray(0,newline).toString('utf8'))
        if(newline>512||Object.keys(record).sort().join(',')!=='backend,channels,format,rate,schema'||
          record.schema!==1||record.backend!=='nori-wasapi'||record.rate!==16000||record.channels!==1||record.format!=='s16le')throw Error()
      }catch{fail();return}
      buffer=buffer.subarray(newline+1);format=true;watchdog.touch();readyResolve()
    }
    while(buffer.length>=4){
      const bytes=buffer.readUInt32LE(0)
      if(ended||bytes>65536||bytes%2){fail();return}
      if(buffer.length<4+bytes)return
      if(!bytes){ended=true;watchdog.stop();buffer=buffer.subarray(4);if(buffer.length)fail();return}
      ring.append(buffer.subarray(4,4+bytes));watchdog.touch();buffer=buffer.subarray(4+bytes);deliver()
    }
  })
  const stop=()=>{
    if(stopping)return stopping
    stopping=(async()=>{
      watchdog.stop()
      pending?.reject(Error('Streaming microphone stopped'));pending=null
      child.stdin.end();let timer
      let result=await Promise.race([exited,new Promise(resolve=>{timer=setTimeout(()=>resolve(null),3000)})])
      clearTimeout(timer)
      if(!result){child.kill();let forced
        result=await Promise.race([exited,new Promise(resolve=>{forced=setTimeout(()=>resolve(null),2000)})]);clearTimeout(forced)}
      ring.clear();buffer.fill(0);buffer=Buffer.alloc(0)
      if(!result)throw Error('Streaming microphone exit not confirmed')
      return true
    })()
    return stopping
  }
  const timer=setTimeout(fail,5000)
  try{await ready}catch(error){await stop();throw error}finally{clearTimeout(timer)}
  return {
    stop,
    nextWindow({advanceBytes=16000,windowBytes=96000}={}){
      if(failureError)return Promise.reject(failureError)
      if(closed||failed||stopping||pending)return Promise.reject(Error('Streaming microphone unavailable or busy'))
      if(!Number.isInteger(advanceBytes)||advanceBytes<2||advanceBytes>128000||advanceBytes%2||
        !Number.isInteger(windowBytes)||windowBytes<2||windowBytes>128000||windowBytes%2)
        return Promise.reject(Error('Invalid rolling microphone window'))
      return new Promise((resolve,reject)=>{pending={resolve,reject,threshold:lastDelivered+advanceBytes,bytes:windowBytes};deliver()})
    },
  }
}
module.exports={startStreamingMicrophone}
