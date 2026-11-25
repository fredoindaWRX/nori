/** Offline STT probe on synthetic audio; never captures microphone input. */
import {spawn} from 'node:child_process'
import {createInterface} from 'node:readline'
import {copyFile,mkdtemp,rm,mkdir} from 'node:fs/promises'
import {join,dirname} from 'node:path'
import {voiceProbeRoot,syntheticVoiceClip,voiceBridge} from './voice-probe-paths.mjs'

// The production worker removes each submitted audio file: give it only a
// disposable copy, not the original generated evidence or any user recording.
await mkdir(voiceProbeRoot,{recursive:true})
const temporary=await mkdtemp(join(voiceProbeRoot,'whisper-probe-'))
if(dirname(temporary)!==voiceProbeRoot)throw new Error('Unsafe probe temporary path')
const clip=join(temporary,'synthetic.wav')
let child,lines
let diagnostics=''
const started=Date.now()
try{
  await copyFile(syntheticVoiceClip,clip)
  child=spawn('F:/release/suite-payload/NoriSuite/apps/NoriV2/.venv-stt/Scripts/python.exe',['-B',voiceBridge('whisper_stt.py')],{
    windowsHide:true,stdio:['pipe','pipe','pipe'],
    env:{...process.env,PYTHONDONTWRITEBYTECODE:'1',HF_HUB_OFFLINE:'1',TRANSFORMERS_OFFLINE:'1',NORI_WHISPER_MODEL:'base.en',NORI_WHISPER_COMPUTE:'int8'},
  })
  lines=createInterface({input:child.stdout})
  child.stderr.on('data',bytes=>{diagnostics=(diagnostics+bytes).slice(-2000)})
  const text=await new Promise((resolveText,reject)=>{
    const deadline=setTimeout(()=>reject(new Error('Offline transcription timed out')),90000)
    const fail=error=>{clearTimeout(deadline);reject(error)}
    child.once('error',fail);child.stdin.on('error',fail)
    child.once('exit',code=>fail(new Error(`Whisper exited: ${code}`)))
    lines.on('line',line=>{
      try{
        if(line.length>65536)throw new Error('Oversized transcription record')
        const message=JSON.parse(line)
        if(message.error)throw new Error(message.error)
        if(message.ready){child.stdin.write(clip+'\n');return}
        if(typeof message.text==='string'){clearTimeout(deadline);resolveText(message.text)}
      }catch(error){fail(error)}
    })
  })
  if(!/ready to help/i.test(text))throw new Error('Synthetic utterance was not recognized')
  console.log(JSON.stringify({passed:true,model:'base.en',device:'cpu',compute:'int8',syntheticTranscript:text,elapsedMs:Date.now()-started,microphoneUsed:false,limitations:['USB interpreter relies on existing PC Python home; no relocated or installed bridge recognition tested.']}))
}catch(error){console.error(error.message);console.error(diagnostics);process.exitCode=1}
finally{lines?.close();if(child){child.kill();if(child.exitCode===null&&child.pid)await new Promise(resolveExit=>child.once('exit',resolveExit))}await rm(temporary,{recursive:true,force:true})}
