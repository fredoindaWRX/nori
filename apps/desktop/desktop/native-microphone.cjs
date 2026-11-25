const {execFile}=require('node:child_process')
const {realpathSync,statSync}=require('node:fs')
const {join,relative,isAbsolute}=require('node:path')

function parseMicrophoneOutput(output){
  if(!Buffer.isBuffer(output)||output.length>400000)throw Error('Invalid microphone output bound')
  const newline=output.indexOf(10)
  if(newline<0||newline>512)throw Error('Missing bounded microphone format')
  let header
  try{header=JSON.parse(output.subarray(0,newline).toString('utf8'))}catch{throw Error('Invalid microphone format')}
  if(!header||Object.keys(header).sort().join(',')!=='backend,channels,format,rate,schema'||
    header.schema!==1||header.backend!=='nori-wasapi'||header.rate!==16000||header.channels!==1||header.format!=='s16le')
    throw Error('Unsupported microphone format')
  const pieces=[];let offset=newline+1,total=0
  while(offset+4<=output.length){
    const bytes=output.readUInt32LE(offset);offset+=4
    if(!bytes){
      if(offset!==output.length||!total)throw Error('Invalid microphone termination')
      return {pcm:Buffer.concat(pieces,total),rate:16000,channels:1,format:'s16le'}
    }
    if(bytes>65536||bytes%2||offset+bytes>output.length||total+bytes>384000)
      throw Error('Invalid microphone packet bound')
    pieces.push(output.subarray(offset,offset+bytes));offset+=bytes;total+=bytes
  }
  throw Error('Missing microphone termination')
}

async function captureNativeMicrophone(root,{duration=2000,signal}={}){
  if(!Number.isInteger(duration)||duration<1||duration>10000)throw Error('Invalid microphone duration')
  if(signal?.aborted)throw Error('Microphone capture cancelled before launch')
  root=realpathSync(root)
  const executable=realpathSync(join(root,'runtime/wake/nori-microphone.exe'))
  const delta=relative(root,executable)
  if(delta.startsWith('..')||isAbsolute(delta)||!statSync(executable).isFile())throw Error('Microphone helper escapes Nori')
  // Callback runs after owned child stdio closes. Never infer release from PCM.
  const output=await new Promise((done,reject)=>{
    let callbackDone=false,closed=false,result,errorResult
    const settle=()=>{
      if(!callbackDone||!closed)return
      if(errorResult)reject(Object.assign(Error('Owned microphone capture failed or cancelled; audio not logged'),
        {ownedHelperExited:true}))
      else done(result)
    }
    const child=execFile(executable,[`--capture-ms=${duration}`],{cwd:root,windowsHide:true,shell:false,
      encoding:'buffer',maxBuffer:400000,timeout:duration+5000,signal},(error,stdout)=>{
      callbackDone=true;result=stdout;errorResult=error;settle()
    })
    // AbortSignal's error notification can precede process termination.
    child.once('close',()=>{closed=true;settle()})
  })
  try{return {...parseMicrophoneOutput(output),ownedHelperExited:true}}
  catch(error){error.ownedHelperExited=true;throw error}
}
module.exports={parseMicrophoneOutput,captureNativeMicrophone}
