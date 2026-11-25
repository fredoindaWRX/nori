import assert from 'node:assert/strict'
import {readFileSync,writeFileSync,mkdirSync,copyFileSync,existsSync} from 'node:fs'
import {setTimeout as delay} from 'node:timers/promises'
const root='C:/Nori/.work/packaged-stt-live',report='C:/Nori/.work/reports/packaged-stt-live.json'
assert.ok(!existsSync(root)&&!existsSync(report),'Existing evidence preserved')
mkdirSync(root+'/apps/desktop/bridge',{recursive:true})
copyFileSync(new URL('../bridge/parakeet_stt.py',import.meta.url),root+'/apps/desktop/bridge/parakeet_stt.py')
Object.assign(process.env,{NORI_ROOT:root,NORI_STT_BACKEND:'parakeet',NORI_PARAKEET_PYTHON:'C:/Program Files/Nori/resources/NoriSuite/integrations/image-generation/runtime/ComfyUI_windows_portable/python_embeded/python.exe'})
let code=readFileSync(new URL('../bridge/whisper.mjs',import.meta.url),'utf8')
const needle='fileURLToPath(import.meta.url)'
assert.equal(code.split(needle).length,2)
// Simulate only Electron's packaged module location; execute the real worker,
// model verification, startup, WAV transport, transcription and shutdown.
code=code.replace(needle,"fileURLToPath('file:///C:/Program%20Files/Nori/resources/app.asar/bridge/whisper.mjs')")
const speech=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'))
const evidence={scope:'simulated ASAR module location with real physical Python worker and model; not installed desktop acceptance',microphoneUsed:false,passed:false}
try{
 speech.startWhisper()
 const deadline=Date.now()+90000
 while(!speech.whisperReady()&&!speech.whisperUnavailable()&&Date.now()<deadline)await delay(100)
 assert.equal(speech.whisperReady(),true,JSON.stringify(speech.whisperStatus()))
 const text=await speech.whisperTranscribe(readFileSync('C:/Nori/.work/reports/parakeet-public-test.wav'),'audio/wav')
 assert.match(text,/portrait/i)
 evidence.transcript=text;evidence.passed=true
}catch(error){evidence.error=String(error.stack||error);process.exitCode=1}
finally{
 await speech.stopWhisper();assert.equal(speech.whisperStatus().state,'stopped')
 evidence.ownedWorkerStopped=true
 writeFileSync(report,JSON.stringify(evidence,null,2),{flag:'wx'})
 console.log(JSON.stringify(evidence))
}
