/** Actual native-contained loopback TTS→STT; no device capture/playback. */
import {spawn,spawnSync} from 'node:child_process'
import {createServer} from 'node:http'
import {mkdtemp,mkdir,rm,writeFile} from 'node:fs/promises'
import {fileURLToPath} from 'node:url'
import {join,resolve} from 'node:path'
import assert from 'node:assert/strict'

const sourceAppRoot=fileURLToPath(new URL('../',import.meta.url))
const sourceRoot=resolve(sourceAppRoot,'../..')
const candidateArgument=process.argv.find(value=>value.startsWith('--candidate='))
const candidate=candidateArgument?.slice('--candidate='.length)
const wakeSample=process.argv.includes('--wake-sample')
const syntheticInput=wakeSample?'Hey Nori, ready to help.':'Nori is ready to help.'
if(candidateArgument&&!/^[a-z0-9][a-z0-9-]{0,63}$/.test(candidate))throw Error('Unsafe speech candidate name')
const packagedRoot=candidate?join(sourceAppRoot,`release/native-desktop-${candidate}/win-unpacked`):null
const appRoot=packagedRoot?join(packagedRoot,'resources/app.asar'):sourceAppRoot
const noriRoot=packagedRoot?join(packagedRoot,'resources/NoriSuite'):sourceRoot
if(['NORI_PYTHON','NORI_TTS_PYTHON','NORI_TTS_MODEL','NORI_TTS_VOICES','NORI_TTS_WORKER'].some(name=>process.env[name]))
  throw new Error('Remove voice developer overrides before native acceptance')
await mkdir(join(noriRoot,'verification'),{recursive:true})
const temporary=await mkdtemp(join(noriRoot,'verification','.native-speech-probe-'))
const reserve=createServer()
await new Promise(resolveReady=>reserve.listen(0,'127.0.0.1',resolveReady))
const port=reserve.address().port
await new Promise(resolveClosed=>reserve.close(resolveClosed))
const child=spawn(packagedRoot?join(packagedRoot,'Nori.exe'):process.execPath,[join(appRoot,'bridge/server.mjs')],{cwd:packagedRoot??appRoot,windowsHide:true,stdio:['ignore','pipe','pipe'],env:{
  ...process.env,NORI_BRAIN:'nori-v2',NORI_LOCAL_CHAT:'1',NORI_ALLOW_WRITES:'0',NORI_BRIDGE_PORT:String(port),
  NORI_ROOT:noriRoot,NORI_SUITE_ROOT:noriRoot,NORI_DATA_ROOT:join(temporary,'data'),NORI_SETTINGS_DIR:join(temporary,'settings'),
  ...(packagedRoot?{ELECTRON_RUN_AS_NODE:'1'}:{}),
  NORI_API_TOKEN:'isolated-synthetic-speech-probe-no-worker-dispatch',
  PYTHONDONTWRITEBYTECODE:'1',HF_HUB_OFFLINE:'1',TRANSFORMERS_OFFLINE:'1',
}})
let logs=''
child.stdout.on('data',bytes=>{logs=(logs+bytes).slice(-3000)})
child.stderr.on('data',bytes=>{logs=(logs+bytes).slice(-3000)})
let spawnError
child.once('error',error=>{spawnError=error})
const origin=`http://127.0.0.1:${port}`,headers={origin:'http://127.0.0.1:5189'}
const started=Date.now()
try{
  let health
  for(let attempt=0;attempt<180;attempt++){
    if(spawnError)throw spawnError
    if(child.exitCode!==null)throw new Error('Speech bridge exited before ready')
    try{const response=await fetch(origin+'/health',{headers,signal:AbortSignal.timeout(1000)});if(response.ok){health=await response.json();if(health.stt)break}}catch{}
    await new Promise(resolveWait=>setTimeout(resolveWait,200))
  }
  assert.equal(health?.localOnly,true);assert.equal(health.stt,true);assert.equal(health.tts,true)
  const tts=await fetch(origin+'/tts',{method:'POST',headers:{...headers,'content-type':'application/json'},body:JSON.stringify({text:syntheticInput}),signal:AbortSignal.timeout(60000)})
  assert.equal(tts.status,200,`TTS failed: ${tts.status}`)
  assert.match(tts.headers.get('content-type'),/audio\/wav/)
  const audio=Buffer.from(await tts.arrayBuffer())
  assert.equal(audio.toString('ascii',0,4),'RIFF');assert.ok(audio.length>4800)
  assert.equal(audio.toString('ascii',36,40),'data','Synthetic WAV must have the expected PCM header')
  const silence=Buffer.from(audio)
  silence.fill(0,44) // Preserve a valid WAV header, zero every PCM sample.
  const silentResponse=await fetch(origin+'/stt',{method:'POST',headers:{...headers,'content-type':'audio/wav'},
    body:silence,signal:AbortSignal.timeout(30000)})
  assert.equal(silentResponse.status,200)
  assert.equal((await silentResponse.json()).text,'','Silence must never become a command')
  const stt=await fetch(origin+'/stt',{method:'POST',headers:{...headers,'content-type':'audio/wav'},body:audio,signal:AbortSignal.timeout(30000)})
  assert.equal(stt.status,200,`STT failed: ${stt.status}`)
  const {text}=await stt.json()
  assert.match(text,/ready to help/i)
  const report={passed:true,localOnly:true,packagedCandidate:candidate??null,ttsHttpStatus:tts.status,sttHttpStatus:stt.status,silenceTranscriptEmpty:true,syntheticTranscript:text,audioBytes:audio.length,elapsedMs:Date.now()-started,microphoneUsed:false,playbackUsed:false,usbRuntimeUsed:false,limitations:[...(!packagedRoot?['Packaged relocation not verified by this source run.']:[]),'Browser playback, wake detection and real microphone recognition not verified.']}
  report.syntheticInput=syntheticInput
  report.wakeSample=wakeSample
  report.syntheticWakeNameRecognized=/\b(?:nori|norrie|norry|norri)\b(?!['’]s\b)/i.test(text)
  report.physicalWakeVerified=false
  if(wakeSample){
    assert.equal(report.syntheticWakeNameRecognized,true,'Generated wake phrase lost the Nori name')
    const cases=[]
    for(const input of ['Hey Nori.','Hey Nori, what time is it?','The weather is clear today.']){
      const generated=await fetch(origin+'/tts',{method:'POST',headers:{...headers,'content-type':'application/json'},body:JSON.stringify({text:input}),signal:AbortSignal.timeout(60000)})
      assert.equal(generated.status,200)
      const recording=Buffer.from(await generated.arrayBuffer())
      const recognized=await fetch(origin+'/stt',{method:'POST',headers:{...headers,'content-type':'audio/wav'},body:recording,signal:AbortSignal.timeout(30000)})
      assert.equal(recognized.status,200)
      const transcript=(await recognized.json()).text
      cases.push({input,transcript,nameRecognized:/\b(?:nori|norrie|norry|norri)\b(?!['’]s\b)/i.test(transcript)})
    }
    report.additionalSyntheticCases=cases
    for(const sample of cases)assert.equal(sample.nameRecognized,sample.input.startsWith('Hey Nori'),
      'Generated wake-name recognition disagrees with the explicit synthetic input')
    // Preserve generated public test audio, never a user's recording.
    await writeFile(join(noriRoot,'verification','synthetic-wake-sample.wav'),audio)
    const padded=Buffer.concat([audio.subarray(0,44),Buffer.alloc(24000),audio.subarray(44),Buffer.alloc(24000)])
    padded.writeUInt32LE(padded.length-8,4)
    padded.writeUInt32LE(padded.length-44,40)
    const paddedResponse=await fetch(origin+'/stt',{method:'POST',headers:{...headers,'content-type':'audio/wav'},body:padded,signal:AbortSignal.timeout(30000)})
    assert.equal(paddedResponse.status,200)
    const paddedText=(await paddedResponse.json()).text
    report.paddedSyntheticTranscript=paddedText
    report.paddedWakeNameRecognized=/\b(?:nori|norrie|norry|norri)\b(?!['’]s\b)/i.test(paddedText)
    assert.equal(report.paddedWakeNameRecognized,true,'Padded generated wake phrase lost the Nori name')
    report.syntheticDurationSeconds=(audio.length-44)/48000
    report.paddingSecondsEachEnd=0.5
  }
  report.elapsedMs=Date.now()-started
  await writeFile(join(noriRoot,'verification',wakeSample?'native-speech-wake-sample-receipt.json':'native-speech-http-receipt.json'),JSON.stringify(report,null,2))
  console.log(JSON.stringify(report))
}catch(error){console.error(error.message);console.error(logs);process.exitCode=1}
finally{
  // Stop only this probe's owned process tree, including persistent Python workers.
  if(child.pid&&child.exitCode===null){
    if(process.platform==='win32')spawnSync('taskkill',['/PID',String(child.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'})
    else child.kill()
    if(child.exitCode===null)await new Promise(resolveExit=>child.once('exit',resolveExit))
  }
  await rm(temporary,{recursive:true,force:true})
}
