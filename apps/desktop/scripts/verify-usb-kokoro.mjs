/** Read-only USB runtime probe. Synthetic speech; no playback or microphone. */
import {spawn} from 'node:child_process'
import {createInterface} from 'node:readline'
import {writeFile,mkdir} from 'node:fs/promises'
import {voiceProbeRoot,syntheticVoiceClip,voiceBridge} from './voice-probe-paths.mjs'

const usb='F:/release/suite-payload/NoriSuite'
const child=spawn(`${usb}/data/voice-runtime/Scripts/python.exe`,['-B',voiceBridge('kokoro_tts.py'),`${usb}/data/voice-models/kokoro-v1/kokoro-v1.0.onnx`,`${usb}/data/voice-models/kokoro-v1/voices-v1.0.bin`],{
  windowsHide:true,stdio:['pipe','pipe','pipe'],
  env:{...process.env,PYTHONDONTWRITEBYTECODE:'1',HF_HUB_OFFLINE:'1',TRANSFORMERS_OFFLINE:'1'},
})
let diagnostics=''
child.stderr.on('data',bytes=>{diagnostics=(diagnostics+bytes).slice(-2000)})
const lines=createInterface({input:child.stdout})
const started=Date.now()
try{
  const audio=await new Promise((resolveAudio,reject)=>{
    const deadline=setTimeout(()=>reject(new Error('Speech probe timed out')),90000)
    const fail=error=>{clearTimeout(deadline);reject(error)}
    child.once('error',fail)
    child.once('exit',code=>fail(new Error(`Speech worker exited: ${code}`)))
    child.stdin.on('error',fail)
    lines.on('line',line=>{
      try{
        if(line.length>8000000)throw new Error('Oversized speech record')
        const message=JSON.parse(line)
        if(message.ready){child.stdin.write(JSON.stringify({id:'read-only-probe',text:'Nori is ready to help.'})+'\n');return}
        if(message.id!=='read-only-probe')return
        if(message.error)throw new Error(`Speech synthesis failed: ${message.error}`)
        clearTimeout(deadline);resolveAudio(Buffer.from(message.audio,'base64'))
      }catch(error){fail(error)}
    })
  })
  if(audio.toString('ascii',0,4)!=='RIFF'||audio.toString('ascii',8,12)!=='WAVE'||audio.readUInt16LE(20)!==1||audio.readUInt16LE(22)!==1||audio.readUInt32LE(24)!==24000||audio.readUInt16LE(34)!==16)throw new Error('Invalid worker WAV format')
  const bytes=audio.readUInt32LE(40)
  if(bytes<4800||bytes+44!==audio.length)throw new Error('Empty or malformed speech WAV')
  let energy=0
  for(let offset=44;offset<audio.length;offset+=2)energy+=audio.readInt16LE(offset)**2
  const rms=Math.sqrt(energy/(bytes/2))
  if(rms<1)throw new Error('Silent speech WAV')
  const output=syntheticVoiceClip
  await mkdir(voiceProbeRoot,{recursive:true})
  await writeFile(output,audio,{flag:'wx'})
  console.log(JSON.stringify({passed:true,output,rate:24000,channels:1,bits:16,durationSeconds:bytes/48000,rms,elapsedMs:Date.now()-started,usbModified:false,limitations:['No playback, transcription, installed bridge or portable relocation tested.']}))
}catch(error){console.error(error.message);console.error(diagnostics);process.exitCode=1}
finally{lines.close();child.kill();if(child.exitCode===null)await new Promise(resolveExit=>child.once('exit',resolveExit))}
