const {spawn}=require('node:child_process')
const {realpathSync,statSync}=require('node:fs')
const {join,relative,isAbsolute}=require('node:path')
const {StringDecoder}=require('node:string_decoder')

async function startWakeTranscriber(root){
  root=realpathSync(root)
  const contained=name=>{
    const file=realpathSync(join(root,name)),delta=relative(root,file)
    if(delta.startsWith('..')||isAbsolute(delta)||!statSync(file).isFile())throw Error('Wake component escapes Nori')
    return file
  }
  const child=spawn(contained('python/Python311/python.exe'),['-I','-B',contained('runtime/wake/transcribe_worker.py')],
    {cwd:root,windowsHide:true,shell:false,stdio:['pipe','pipe','ignore']})
  let ready=false,closed=false,failed=false,buffer='',pending,stopping,resolveReady,rejectReady
  const decoder=new StringDecoder('utf8')
  const readyPromise=new Promise((done,reject)=>{resolveReady=done;rejectReady=reject})
  const exited=new Promise(done=>{
    child.once('exit',(code,signal)=>{closed=true;done({code,signal})})
    child.once('error',()=>{closed=true;done({error:true})})
  })
  const fail=()=>{
    if(failed)return
    failed=true
    rejectReady(Error('Owned wake transcription worker failed'))
    if(pending){clearTimeout(pending.timer);pending.reject(Error('Wake transcription failed'));pending=null}
    child.stdin.end()
  }
  child.stdin.on('error',fail)
  exited.then(fail)
  child.stdout.on('data',chunk=>{
    if(failed)return
    buffer+=decoder.write(chunk)
    if(buffer.length>4096){fail();return}
    let newline
    while((newline=buffer.indexOf('\n'))>=0){
      const line=buffer.slice(0,newline);buffer=buffer.slice(newline+1)
      let record
      try{record=JSON.parse(line)}catch{fail();return}
      if(!record||typeof record!=='object'||Array.isArray(record)){fail();return}
      if(!ready){
        if(record?.ready!==true||record.backend!=='local-whisper-pcm'||record.audio_files!==false){fail();return}
        ready=true;resolveReady();continue
      }
      if(!pending){fail();return}
      const request=pending;pending=null;clearTimeout(request.timer)
      if(Object.keys(record).join(',')==='text'&&typeof record.text==='string'&&record.text.length<=512)
        request.resolve(record.text)
      else request.reject(Error('Wake transcription refused audio'))
    }
  })
  const stop=()=>{
    if(stopping)return stopping
    stopping=(async()=>{
      fail();let timer
      const finished=await Promise.race([exited,new Promise(done=>{timer=setTimeout(()=>done(null),10000)})])
      clearTimeout(timer)
      if(finished)return true
      child.kill();let forcedTimer
      const killed=await Promise.race([exited,new Promise(done=>{forcedTimer=setTimeout(()=>done(null),2000)})])
      clearTimeout(forcedTimer)
      if(!killed)throw Error('Owned wake worker exit not confirmed')
      return true
    })()
    return stopping
  }
  const startupTimer=setTimeout(fail,30000)
  try{await readyPromise} catch(error){await stop();throw error}
  finally{clearTimeout(startupTimer)}
  return {
    stop,
    transcribe(pcm){
      if(closed||failed||stopping||pending)return Promise.reject(Error('Wake worker unavailable or busy'))
      if(!Buffer.isBuffer(pcm)||!pcm.length||pcm.length%2||pcm.length>384000)
        return Promise.reject(Error('Invalid wake PCM bound'))
      return new Promise((resolve,reject)=>{
        const timer=setTimeout(()=>{fail();void stop().catch(()=>{})},15000)
        pending={resolve,reject,timer}
        child.stdin.write(JSON.stringify({pcm_s16le_b64:pcm.toString('base64')})+'\n',error=>{if(error)fail()})
      })
    },
  }
}
module.exports={startWakeTranscriber}
