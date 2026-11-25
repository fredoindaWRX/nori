import assert from 'node:assert/strict'
import {spawn} from 'node:child_process'
import {createInterface} from 'node:readline'
import {writeFileSync,existsSync,mkdtempSync,rmSync,realpathSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join,resolve} from 'node:path'
const report='C:/Nori/.work/reports/parakeet-worker-probe.json'
assert.ok(!existsSync(report),'Existing evidence preserved')
const directory=mkdtempSync(join(tmpdir(),'nori-parakeet-synthetic-'))
const sample='C:/Nori/.work/reports/parakeet-public-test.wav'
const silence=join(directory,'silence.wav'),wave=Buffer.alloc(44+32000)
wave.write('RIFF');wave.writeUInt32LE(wave.length-8,4);wave.write('WAVEfmt ',8);wave.writeUInt32LE(16,16)
wave.writeUInt16LE(1,20);wave.writeUInt16LE(1,22);wave.writeUInt32LE(16000,24);wave.writeUInt32LE(32000,28)
wave.writeUInt16LE(2,32);wave.writeUInt16LE(16,34);wave.write('data',36);wave.writeUInt32LE(32000,40)
writeFileSync(silence,wave)
const child=spawn('C:/Program Files/Nori/resources/NoriSuite/integrations/image-generation/runtime/ComfyUI_windows_portable/python_embeded/python.exe',
 ['-I','-B','-u','C:/Nori/apps/desktop/bridge/parakeet_stt.py'],{windowsHide:true,stdio:['pipe','pipe','pipe']})
const lines=createInterface({input:child.stdout})
let queue=[],waiting,stderr=''
child.stderr.on('data',bytes=>{stderr=(stderr+bytes.toString()).slice(-2500)})
lines.on('line',line=>{const value=JSON.parse(line);if(waiting){const resolve=waiting;waiting=null;resolve(value)}else queue.push(value)})
const exited=new Promise((resolve,reject)=>{child.once('exit',code=>resolve(code));child.once('error',reject)})
async function receive(){
 let timer
 try{return await Promise.race([queue.length?Promise.resolve(queue.shift()):new Promise(r=>{waiting=r}),
  exited.then(()=>{throw Error('Worker exited: '+stderr)}),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Worker deadline: '+stderr)),90000)})])}
 finally{clearTimeout(timer)}
}
try{
 const ready=await receive();assert.equal(ready.ready,true);assert.equal(ready.model,'parakeet-tdt-0.6b-v3')
 child.stdin.write(join(directory,'missing.wav')+'\n');assert.ok((await receive()).error)
 child.stdin.write(silence+'\n');assert.equal((await receive()).text,'')
 const began=performance.now();child.stdin.write(sample+'\n');const speech=await receive()
 assert.match(speech.text,/portrait/i)
 child.stdin.end();assert.equal(await exited,0)
 const result={ready:true,backend:'cpu',badAudioRecovered:true,silenceEmpty:true,publicAudioTranscribed:true,
  transcript:speech.text,warmTranscriptionSeconds:Number(((performance.now()-began)/1000).toFixed(3)),
  microphoneUsed:false,ownedWorkerStopped:true,installedAppVerified:false}
 writeFileSync(report,JSON.stringify(result,null,2),{flag:'wx'});console.log(JSON.stringify(result))
}finally{
 if(child.exitCode===null)child.kill()
 lines.close()
 assert.equal(realpathSync(directory).toLowerCase(),resolve(directory).toLowerCase());rmSync(directory,{recursive:true})
}
