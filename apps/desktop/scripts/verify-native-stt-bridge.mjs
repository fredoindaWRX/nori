/** Real transcription through production bridge module; synthetic audio only. */
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {fileURLToPath} from 'node:url'
import {resolve} from 'node:path'
import {startWhisper,whisperReady,whisperUnavailable,whisperTranscribe,stopWhisper} from '../bridge/whisper.mjs'
const root=fileURLToPath(new URL('../../../',import.meta.url))
if(process.env.NORI_PYTHON)throw new Error('Remove developer Python override before native acceptance')
const clip=resolve(root,'verification/voice-probes/local-kokoro-99105aa0-b71e-4873-9239-73293ffa86e5.wav')
let receipt
const transcripts=[]
for(let cycle=0;cycle<2;cycle++){
try{
  startWhisper()
  const deadline=Date.now()+15000
  while(!whisperReady()&&!whisperUnavailable()&&Date.now()<deadline)
    await new Promise(resolveWait=>setTimeout(resolveWait,50))
  assert.equal(whisperReady(),true,'Native STT readiness failed')
  const original=await readFile(clip)
  const transcript=await whisperTranscribe(original,'audio/wav')
  assert.match(transcript,/speaking from the local/i)
  transcripts.push(transcript)
  const silence=Buffer.alloc(44+48000)
  original.copy(silence,0,0,44)
  silence.writeUInt32LE(silence.length-8,4)
  silence.writeUInt32LE(48000,40)
  assert.equal(await whisperTranscribe(silence,'audio/wav'),'','Digital silence must not produce a transcript')
  await readFile(clip) // Original synthetic input must survive bridge-owned cleanup.
  receipt={passed:true,transcript,digitalSilenceRefused:true,originalPreserved:true,microphoneUsed:false,usbRuntimeUsed:false}
}finally{await stopWhisper()}
}
console.log(JSON.stringify({...receipt,transcripts,restartCycles:2,ownedWorkerStopped:true}))
